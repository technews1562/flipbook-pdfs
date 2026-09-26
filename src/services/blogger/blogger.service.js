const nodemailer = require('nodemailer');
const config = require('../../config');

class BloggerService {
  constructor() {
    this.blogId = config.blogger.blogId;
    this.blogDomain = config.blogger.blogDomain;
    this.clientId = config.blogger.clientId;
    this.clientSecret = config.blogger.clientSecret;
    this.refreshToken = config.blogger.refreshToken;
    this.staticAccessToken = config.blogger.accessToken;

    // Email Publishing settings
    this.resendApiKey = config.blogger.resendApiKey;
    this.postEmail = config.blogger.postEmail;
    this.smtpHost = config.blogger.smtpHost;
    this.smtpPort = config.blogger.smtpPort;
    this.smtpUser = config.blogger.smtpUser;
    this.smtpPass = config.blogger.smtpPass;
  }

  /**
   * Refresh or retrieve Google OAuth2 access token
   * @returns {Promise<string|null>}
   */
  async getAccessToken() {
    if (this.clientId && this.clientSecret && this.refreshToken) {
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken,
            grant_type: 'refresh_token'
          })
        });

        const tokenData = await tokenRes.json();
        if (tokenData.access_token) {
          return tokenData.access_token;
        }
        console.warn('[Blogger Service] Token refresh response warning:', tokenData);
      } catch (err) {
        console.error('[Blogger Service] Failed to refresh Google OAuth token:', err);
      }
    }

    if (this.staticAccessToken) {
      return this.staticAccessToken;
    }

    return null;
  }

  /**
   * Create a publication post on Blogger via REST API, Resend HTTPS API, or Secret Post Email
   * @param {Object} publication
   * @returns {Promise<{ postId: string, postUrl: string }>}
   */
  async createPost(publication) {
    const postContent = `
<div class="blog-pdf-flipbook" data-document-id="${publication.id}" data-pdf="${publication.pdf_url}">
  <p><a href="${publication.pdf_url}">Read ${publication.title} (PDF)</a></p>
</div>
<p>${publication.description || 'Read our interactive digital publication above in full 3D flipbook mode.'}</p>
`.trim();

    // Strategy 1: Google Blogger REST API (if OAuth credentials configured)
    const token = await this.getAccessToken();
    if (token) {
      const postPayload = {
        kind: 'blogger#post',
        title: publication.title,
        content: postContent,
        labels: publication.category ? [publication.category] : ['Magazine']
      };

      const apiUrl = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postPayload)
      });

      if (response.ok) {
        const postData = await response.json();
        return {
          postId: postData.id,
          postUrl: postData.url
        };
      }
      const errData = await response.json().catch(() => ({}));
      console.warn(`[Blogger API Warning] ${errData.error?.message || response.statusText}. Checking email fallback...`);
    }

    // Strategy 2: Resend HTTPS API (Recommended for cloud hosting like Railway where SMTP ports are blocked)
    if (this.resendApiKey && this.postEmail) {
      try {
        return await this.createPostViaResend(publication, postContent);
      } catch (resendErr) {
        console.warn('[Blogger Resend Warning]', resendErr.message, '- Checking SMTP fallback...');
      }
    }

    // Strategy 3: Blogger "Post using email" via SMTP
    if (this.postEmail && this.smtpUser && this.smtpPass) {
      return await this.createPostViaEmail(publication, postContent);
    }

    throw new Error('Blogger publishing is not configured (neither Google OAuth, Resend API, nor BLOGGER_POST_EMAIL with SMTP credentials provided).');
  }

  /**
   * Post to Blogger via Resend HTTPS REST API (Port 443, zero blocking on cloud hosts)
   * @param {Object} publication
   * @param {string} postContent
   */
  async createPostViaResend(publication, postContent) {
    console.log(`[Blogger Resend API] Sending email via Resend to ${this.postEmail}...`);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'FlipView Publisher <onboarding@resend.dev>',
        to: [this.postEmail],
        subject: publication.title,
        html: postContent
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Resend API error (${res.status}): ${err.message || res.statusText}`);
    }

    const data = await res.json();
    console.log(`[Blogger Resend API] Message delivered to Blogger successfully (ID: ${data.id})!`);
    return {
      postId: 'resend_' + data.id,
      postUrl: `https://${this.blogDomain}`
    };
  }

  /**
   * Post to Blogger via secret email (technews1562.flipbook@blogger.com)
   * @param {Object} publication
   * @param {string} postContent
   */
  async createPostViaEmail(publication, postContent) {
    console.log(`[Blogger Email] Sending publication to secret Blogger email: ${this.postEmail}`);

    const mailOptions = {
      from: `"FlipView Publisher" <${this.smtpUser}>`,
      to: this.postEmail,
      subject: publication.title,
      html: postContent
    };

    // Strategy A: Port 587 STARTTLS (IPv4 explicit)
    try {
      console.log('[Blogger Email] Attempting SMTP via smtp.gmail.com:587 (STARTTLS, IPv4)...');
      const transporter587 = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        family: 4,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          rejectUnauthorized: false
        }
      });

      const info = await transporter587.sendMail(mailOptions);
      console.log(`[Blogger Email] Message sent successfully via Port 587 (ID: ${info.messageId})!`);
      return {
        postId: 'email_' + Date.now(),
        postUrl: `https://${this.blogDomain}`
      };
    } catch (err587) {
      console.warn('[Blogger Email] Port 587 attempt failed:', err587.message, '- Trying Port 465 fallback...');
    }

    // Strategy B: Port 465 Direct SSL (IPv4 explicit)
    try {
      console.log('[Blogger Email] Attempting SMTP via smtp.gmail.com:465 (SSL, IPv4)...');
      const transporter465 = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        family: 4,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          rejectUnauthorized: false
        }
      });

      const info = await transporter465.sendMail(mailOptions);
      console.log(`[Blogger Email] Message sent successfully via Port 465 (ID: ${info.messageId})!`);
      return {
        postId: 'email_' + Date.now(),
        postUrl: `https://${this.blogDomain}`
      };
    } catch (err465) {
      console.error('[Blogger Email] Port 465 attempt failed:', err465.message);
      throw new Error(`Email delivery to Blogger failed: Port 587 and Port 465 both timed out or were blocked (${err465.message})`);
    }
  }

  /**
   * Update an existing Blogger post
   * @param {string} postId
   * @param {Object} publication
   */
  async updatePost(postId, publication) {
    const token = await this.getAccessToken();
    if (!token) return null;

    const postContent = `
<div class="blog-pdf-flipbook" data-document-id="${publication.id}" data-pdf="${publication.pdf_url}">
  <p><a href="${publication.pdf_url}">Read ${publication.title} (PDF)</a></p>
</div>
<p>${publication.description || 'Read our interactive digital publication above in full 3D flipbook mode.'}</p>
`.trim();

    const apiUrl = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}`;
    const response = await fetch(apiUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: publication.title,
        content: postContent,
        labels: publication.category ? [publication.category] : ['Magazine']
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Blogger API update error: ${errData.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Delete post from Blogger
   * @param {string} postId
   */
  async deletePost(postId) {
    const token = await this.getAccessToken();
    if (!token) return false;

    const apiUrl = `https://www.googleapis.com/blogger/v3/blogs/${this.blogId}/posts/${postId}`;
    try {
      const res = await fetch(apiUrl, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.ok;
    } catch (e) {
      console.error('[Blogger Delete Error]', e);
      return false;
    }
  }
}

module.exports = new BloggerService();
