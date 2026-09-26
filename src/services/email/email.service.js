const nodemailer = require('nodemailer');
const config = require('../../config');

class EmailService {
  constructor() {
    this.smtpHost = config.email?.smtpHost || 'smtp.gmail.com';
    this.smtpPort = config.email?.smtpPort || 587;
    this.smtpUser = config.email?.smtpUser || 'technews1562@gmail.com';
    this.smtpPass = config.email?.smtpPass || 'unxkuzpunhknpadt';
    this.resendApiKey = config.email?.resendApiKey || config.blogger?.resendApiKey || '';
    this.fromAddress = config.email?.fromAddress || '"FlipView Security" <technews1562@gmail.com>';
  }

  /**
   * Create nodemailer transporter
   */
  getTransporter() {
    return nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpPort === 465,
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
  }

  /**
   * Send Password Reset Verification Code Email
   * @param {string} recipientEmail
   * @param {string} code 6-digit code
   * @param {string} [recipientName]
   */
  async sendPasswordResetEmail(recipientEmail, code, recipientName = '') {
    const greeting = recipientName ? `Hello ${recipientName},` : 'Hello,';
    const subject = `Your FlipView Password Reset Code: ${code}`;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reset Your Password</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .content { padding: 32px 28px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
    .body-text { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .code-box { background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .code-value { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; margin: 0; }
    .code-instruction { font-size: 13px; color: #64748b; margin-top: 8px; margin-bottom: 0; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 28px; font-size: 13px; color: #94a3b8; text-align: center; }
    .warning { font-size: 13px; color: #64748b; background: #f8fafc; border-left: 3px solid #f59e0b; padding: 10px 14px; border-radius: 4px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>FlipView</h1>
    </div>
    <div class="content">
      <p class="greeting">${greeting}</p>
      <p class="body-text">We received a request to reset the password for your FlipView account. Use the 6-digit verification code below to complete your password reset:</p>
      
      <div class="code-box">
        <div class="code-value">${code}</div>
        <p class="code-instruction">This verification code expires in 15 minutes.</p>
      </div>

      <div class="warning">
        <strong>Didn't request this?</strong> If you didn't ask to reset your password, you can safely ignore this email. Your account remains secure.
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} FlipView PDF Publisher. All rights reserved.
    </div>
  </div>
</body>
</html>
    `.trim();

    const text = `
${greeting}

We received a request to reset your FlipView password.
Your 6-digit verification code is: ${code}

This code will expire in 15 minutes.

If you did not request this, please ignore this email.
    `.trim();

    // Strategy 1: Resend API if configured
    if (this.resendApiKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'FlipView <onboarding@resend.dev>',
            to: [recipientEmail],
            subject: subject,
            html: html,
            text: text
          })
        });
        if (res.ok) {
          const data = await res.json();
          console.log(`[Email Service] Password reset email sent via Resend to ${recipientEmail} (ID: ${data.id})`);
          return true;
        }
      } catch (err) {
        console.warn('[Email Service] Resend API failed, falling back to SMTP:', err.message);
      }
    }

    // Strategy 2: Gmail SMTP
    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: this.fromAddress,
        to: recipientEmail,
        subject: subject,
        html: html,
        text: text
      });
      console.log(`[Email Service] Password reset code sent to ${recipientEmail} (ID: ${info.messageId})`);
      return true;
    } catch (smtpErr) {
      console.error(`[Email Service] SMTP send failed for ${recipientEmail}:`, smtpErr.message);
      // Log code for debugging / local testing fallback
      console.log(`[Email Service] [FALLBACK_DEV_CODE] Email: ${recipientEmail} | Code: ${code}`);
      return false;
    }
  }
}

module.exports = new EmailService();
