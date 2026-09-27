async function testLiveForgotPassword() {
  console.log('Testing Live Production Forgot Password API...');
  
  // 1. Forgot password request
  const response = await fetch('https://publisher.convertlyfiles.com/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'technews1562@gmail.com' })
  });

  const data = await response.json();
  console.log('Live /api/auth/forgot-password status:', response.status);
  console.log('Response body:', data);
}

// Wait 15 seconds for Railway auto-deploy
setTimeout(testLiveForgotPassword, 15000);
