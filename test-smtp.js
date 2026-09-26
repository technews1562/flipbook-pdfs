const nodemailer = require('nodemailer');

async function testGmailSmtp() {
  console.log('Testing Gmail SMTP connection...');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'technews1562@gmail.com',
      pass: 'unxkuzpunhknpadt'
    }
  });

  try {
    const verify = await transporter.verify();
    console.log('SMTP Verify Succeeded:', verify);

    const info = await transporter.sendMail({
      from: '"FlipView Publisher" <technews1562@gmail.com>',
      to: 'technews1562.flipbook@blogger.com',
      subject: 'Test SMTP Publication ' + new Date().toLocaleTimeString(),
      html: `
        <div class="blog-pdf-flipbook" data-document-id="pub_test_smtp" data-pdf="https://pub-c3a5125cbd404e6daf2ecc7e6e6c7799.r2.dev/uploads/2026/09/pub_mufjiyplsnwkxx/ddl-sample.pdf">
          <p><a href="https://pub-c3a5125cbd404e6daf2ecc7e6e6c7799.r2.dev/uploads/2026/09/pub_mufjiyplsnwkxx/ddl-sample.pdf">Read Test Magazine (PDF)</a></p>
        </div>
      `
    });

    console.log('EMAIL SENT SUCCESSFULLY! MessageId:', info.messageId, 'Response:', info.response);
  } catch (err) {
    console.error('SMTP ERROR:', err);
  }
}

testGmailSmtp();
