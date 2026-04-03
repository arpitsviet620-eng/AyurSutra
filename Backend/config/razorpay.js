// config/razorpayTest.js - For testing
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Test credentials (fallback for development)
const TEST_KEY_ID = 'rzp_test_1DP5mmOlF5G5ag'; // Example test key
const TEST_KEY_SECRET = 'ThisIsATestKeySecretDoNotUseInProduction'; // Example test secret

// Get credentials from environment or use test credentials
const keyId = process.env.RAZORPAY_KEY_ID || TEST_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET || TEST_KEY_SECRET;

console.log('🔑 Razorpay Key ID:', keyId ? `${keyId.substring(0, 10)}...` : 'Not set');
console.log('🔐 Razorpay Key Secret:', keySecret ? 'Set' : 'Not set');

// Initialize Razorpay
const razorpayInstance = new Razorpay({
  key_id: keyId,
  key_secret: keySecret
});

// Test the connection
async function testRazorpayConnection() {
  try {
    console.log('🧪 Testing Razorpay connection...');
    
    // Simple test - get account details
    const account = await razorpayInstance.payments.all({
      count: 1
    });
    
    console.log('✅ Razorpay connection successful!');
    console.log('📊 Mode:', keyId.startsWith('rzp_test_') ? 'TEST' : 'LIVE');
    
    return true;
  } catch (error) {
    console.error('❌ Razorpay connection failed:', error.message);
    if (error.error && error.error.description) {
      console.error('Error details:', error.error.description);
    }
    
    // Provide helpful debugging info
    if (error.statusCode === 401) {
      console.error('\n🔍 TROUBLESHOOTING:');
      console.error('1. Check if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set in .env');
      console.error('2. Visit https://dashboard.razorpay.com/#/app/keys to get your API keys');
      console.error('3. Make sure you are using TEST keys (rzp_test_) for development');
      console.error('4. Keys should look like:');
      console.error('   - Key ID: rzp_test_XXXXXXXXXXXXXXXX');
      console.error('   - Key Secret: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    }
    
    return false;
  }
}

// Verify payment signature
const verifyPaymentSignature = (orderId, paymentId, signature) => {
  try {
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body.toString())
      .digest('hex');
    
    const isValid = expectedSignature === signature;
    console.log(`🔐 Signature verification: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

module.exports = {
  razorpay: razorpayInstance,
  verifyPaymentSignature,
  testRazorpayConnection,
  isTestMode: keyId.startsWith('rzp_test_')
};