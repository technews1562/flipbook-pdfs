const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../../config');

class StorageService {
  constructor() {
    this.isR2Configured = Boolean(
      config.storage.accountId &&
      config.storage.accessKeyId &&
      config.storage.secretAccessKey &&
      config.storage.bucketName
    );

    if (this.isR2Configured) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: config.storage.endpoint,
        credentials: {
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey
        }
      });
      this.bucket = config.storage.bucketName;
      this.publicUrl = config.storage.publicUrl;
      console.log(`[Storage] Initialized Cloudflare R2 client for bucket "${this.bucket}"`);
    } else {
      console.warn('[Storage] R2 credentials not fully set. Falling back to local file storage.');
      this.localDir = config.storage.localStorageDir;
      if (!fs.existsSync(this.localDir)) {
        fs.mkdirSync(this.localDir, { recursive: true });
      }
    }
  }

  /**
   * Upload binary data to storage
   * @param {string} key - storage key e.g. uploads/2026/09/pub_01J.../doc.pdf
   * @param {Buffer} buffer - file content buffer
   * @param {string} contentType - mime type e.g. application/pdf
   * @returns {Promise<{ key: string, url: string }>}
   */
  async upload(key, buffer, contentType = 'application/octet-stream') {
    const cleanKey = key.replace(/^\/+/, '');

    if (this.isR2Configured) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        Body: buffer,
        ContentType: contentType
      });

      await this.s3.send(command);
      const url = this.getUrl(cleanKey);
      return { key: cleanKey, url };
    } else {
      // Local fallback
      const targetPath = path.join(this.localDir, cleanKey);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, buffer);
      const url = this.getUrl(cleanKey);
      return { key: cleanKey, url };
    }
  }

  /**
   * Delete object from storage
   * @param {string} key
   */
  async delete(key) {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.isR2Configured) {
      try {
        const command = new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: cleanKey
        });
        await this.s3.send(command);
        return true;
      } catch (err) {
        console.error(`[Storage Delete Error] Key: ${cleanKey}:`, err);
        return false;
      }
    } else {
      const targetPath = path.join(this.localDir, cleanKey);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        return true;
      }
      return false;
    }
  }

  /**
   * Check if object exists
   * @param {string} key
   */
  async exists(key) {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.isR2Configured) {
      try {
        const command = new HeadObjectCommand({
          Bucket: this.bucket,
          Key: cleanKey
        });
        await this.s3.send(command);
        return true;
      } catch (err) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err;
      }
    } else {
      const targetPath = path.join(this.localDir, cleanKey);
      return fs.existsSync(targetPath);
    }
  }

  /**
   * Get public or proxied URL for key
   * @param {string} key
   */
  getUrl(key) {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.publicUrl) {
      return `${this.publicUrl}/${cleanKey}`;
    }
    return `${config.appUrl}/api/storage/${cleanKey}`;
  }

  /**
   * Get buffer stream (for proxy or processing)
   * @param {string} key
   */
  async getBuffer(key) {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.isR2Configured) {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey
      });
      const response = await this.s3.send(command);
      const streamToBuffer = async (stream) => {
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      };
      return await streamToBuffer(response.Body);
    } else {
      const targetPath = path.join(this.localDir, cleanKey);
      if (!fs.existsSync(targetPath)) {
        throw new Error(`File not found: ${cleanKey}`);
      }
      return fs.readFileSync(targetPath);
    }
  }

  /**
   * Get readable stream with optional range
   * @param {string} key
   * @param {string} [range] - e.g. "bytes=0-1048575"
   * @returns {Promise<{ stream: NodeJS.ReadableStream, contentLength?: number, contentRange?: string, contentType?: string, totalSize?: number, isRange: boolean, eTag?: string, lastModified?: Date }>}
   */
  async getReadStream(key, range) {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.isR2Configured) {
      const params = {
        Bucket: this.bucket,
        Key: cleanKey
      };
      if (range) {
        params.Range = range;
      }
      const command = new GetObjectCommand(params);
      const response = await this.s3.send(command);
      return {
        stream: response.Body,
        contentLength: response.ContentLength,
        contentRange: response.ContentRange,
        contentType: response.ContentType || 'application/pdf',
        isRange: Boolean(response.ContentRange),
        eTag: response.ETag,
        lastModified: response.LastModified
      };
    } else {
      const targetPath = path.join(this.localDir, cleanKey);
      if (!fs.existsSync(targetPath)) {
        throw new Error(`File not found: ${cleanKey}`);
      }
      const stat = fs.statSync(targetPath);
      const totalSize = stat.size;
      let start = 0;
      let end = totalSize - 1;
      let isRange = false;

      if (range && typeof range === 'string' && range.startsWith('bytes=')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const partStart = parts[0];
        const partEnd = parts[1];

        if (partStart !== '' && partEnd !== '') {
          start = parseInt(partStart, 10);
          end = parseInt(partEnd, 10);
        } else if (partStart !== '' && partEnd === '') {
          start = parseInt(partStart, 10);
          end = totalSize - 1;
        } else if (partStart === '' && partEnd !== '') {
          start = totalSize - parseInt(partEnd, 10);
          end = totalSize - 1;
        }

        if (start < 0) start = 0;
        if (end >= totalSize) end = totalSize - 1;
        if (start <= end) {
          isRange = true;
        }
      }

      const stream = fs.createReadStream(targetPath, isRange ? { start, end } : undefined);
      return {
        stream,
        contentLength: isRange ? (end - start + 1) : totalSize,
        contentRange: isRange ? `bytes ${start}-${end}/${totalSize}` : undefined,
        contentType: 'application/pdf',
        totalSize,
        isRange,
        lastModified: stat.mtime
      };
    }
  }
}

module.exports = new StorageService();
