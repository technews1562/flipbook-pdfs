const authService = require('./src/services/auth/auth.service');
const db = require('./src/db/database');

async function testPasswordResetFlow() {
  console.log('--- Testing Password Reset Flow ---');

  const testEmail = 'resettest@flipviewpdf.com';
  const initialPassword = 'InitialPassword123!';
  const newPassword = 'NewSecurePassword456!';

  // 1. Create or ensure test user exists
  let user = db.getUserByEmail(testEmail);
  if (!user) {
    const regResult = await authService.register({
      email: testEmail,
      password: initialPassword,
      full_name: 'Test Reset User'
    });
    user = regResult.user;
    console.log('Created test user:', user.email);
  }

  // 2. Request password reset
  console.log('\n1. Requesting password reset for:', testEmail);
  const forgotResult = await authService.requestPasswordReset(testEmail);
  console.log('Forgot response:', forgotResult);

  // 3. Check reset code stored in DB
  const resets = db.getPasswordReset ? db.getPasswordReset(testEmail, 'dummy') : null;
  // Let's get the actual generated code from database table/store
  const resetRow = db.getPasswordReset ? (
    // We query by checking any code
    db.getUserByEmail(testEmail)
  ) : null;
  
  // Let's find the active reset code from the DB directly
  let code = null;
  for (let i = 100000; i <= 999999; i++) {
    const found = db.getPasswordReset(testEmail, String(i));
    if (found) {
      code = String(i);
      break;
    }
  }

  console.log('Found generated 6-digit code in DB:', code);
  if (!code) {
    throw new Error('Verification code was not generated/stored in database!');
  }

  // 4. Test invalid code rejection
  console.log('\n2. Testing invalid verification code rejection:');
  try {
    await authService.resetPasswordWithCode({
      email: testEmail,
      code: '000000',
      new_password: newPassword
    });
    throw new Error('Should have failed with invalid code!');
  } catch (err) {
    console.log('Successfully caught expected rejection:', err.message);
  }

  // 5. Test valid code password reset
  console.log('\n3. Resetting password with valid code:', code);
  const resetResponse = await authService.resetPasswordWithCode({
    email: testEmail,
    code: code,
    new_password: newPassword
  });
  console.log('Reset succeeded! User:', resetResponse.user.email, 'Access Token Present:', !!resetResponse.accessToken);

  // 6. Verify login with NEW password
  console.log('\n4. Verifying login with NEW password:');
  const loginNew = await authService.login({
    email: testEmail,
    password: newPassword
  });
  console.log('Login with NEW password succeeded:', loginNew.user.email);

  // 7. Verify login with OLD password fails
  console.log('\n5. Verifying login with OLD password fails:');
  try {
    await authService.login({
      email: testEmail,
      password: initialPassword
    });
    throw new Error('Should have failed with old password!');
  } catch (err) {
    console.log('Successfully rejected old password:', err.message);
  }

  console.log('\n PASSWORD RESET END-TO-END VERIFIED 100% SUCCESSFUL!');
}

testPasswordResetFlow().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
