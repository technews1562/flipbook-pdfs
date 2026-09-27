const emailService = require('./src/services/email/email.service');

async function testEmail() {
  console.log('Sending direct test verification email via EmailService...');
  const success = await emailService.sendPasswordResetEmail('technews1562@gmail.com', '789123', 'Nirav');
  console.log('Email send result:', success);
}

testEmail().catch(console.error);
