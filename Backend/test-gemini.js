// Test script for Gemini API key validation
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGeminiAPI() {
  console.log('🔍 Testing Gemini API Key...\n');
  
  // Check if API key exists
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env file');
    process.exit(1);
  }
  
  console.log(`✅ API Key found: ${apiKey.substring(0, 10)}...`);
  console.log(`📦 Model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'}\n`);
  
  try {
    // Initialize the client
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
    });
    
    console.log('🚀 Sending test request...');
    
    // Test with a simple prompt
    const result = await model.generateContent('Say "Hello, your API key is working!" in one sentence.');
    const response = result.response;
    const text = response.text();
    
    console.log('\n✅ SUCCESS! API Key is working!\n');
    console.log('📝 Response from Gemini:');
    console.log('─'.repeat(50));
    console.log(text);
    console.log('─'.repeat(50));
    console.log('\n✨ Your Gemini service is ready to use!\n');
    
  } catch (error) {
    console.error('\n❌ ERROR: API Key test failed!\n');
    console.error('Error Details:', error.message);
    
    if (error.message.includes('API_KEY_INVALID') || error.message.includes('API key not valid')) {
      console.error('\n💡 Solution: Your API key is invalid. Please:');
      console.error('   1. Go to https://makersuite.google.com/app/apikey');
      console.error('   2. Create a new API key');
      console.error('   3. Update GEMINI_API_KEY in your .env file');
    } else if (error.message.includes('404')) {
      console.error('\n💡 Solution: Model not found. Try these models:');
      console.error('   - gemini-2.0-flash-exp');
      console.error('   - gemini-1.5-flash');
      console.error('   - gemini-1.5-pro');
    } else if (error.message.includes('429')) {
      console.error('\n💡 Solution: Quota exceeded. Please wait and try again.');
    } else if (error.message.includes('billing') || error.message.includes('permission')) {
      console.error('\n💡 Solution: Enable billing in Google Cloud Console');
      console.error('   https://console.cloud.google.com/billing');
    }
    
    console.error('\nFull Error:', error);
    process.exit(1);
  }
}

// Run the test
testGeminiAPI();
