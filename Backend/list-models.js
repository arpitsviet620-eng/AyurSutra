// List available Gemini models for your API key
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listAvailableModels() {
  console.log('🔍 Fetching available Gemini models...\n');
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env file');
    process.exit(1);
  }
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // List all available models
    const models = await genAI.listModels();
    
    console.log('✅ Available models for your API key:\n');
    console.log('─'.repeat(70));
    
    let generateContentModels = [];
    
    for await (const model of models) {
      const supportsGenerate = model.supportedGenerationMethods.includes('generateContent');
      
      if (supportsGenerate) {
        generateContentModels.push(model.name);
        console.log(`✓ ${model.name}`);
        console.log(`  Display Name: ${model.displayName}`);
        console.log(`  Description: ${model.description}`);
        console.log(`  Methods: ${model.supportedGenerationMethods.join(', ')}`);
        console.log('─'.repeat(70));
      }
    }
    
    if (generateContentModels.length > 0) {
      console.log('\n💡 Recommended models for your .env file:');
      console.log('─'.repeat(70));
      generateContentModels.forEach(model => {
        // Extract just the model name without the "models/" prefix
        const modelName = model.replace('models/', '');
        console.log(`GEMINI_MODEL=${modelName}`);
      });
      console.log('\n🎯 Pick one and update your .env file!\n');
    } else {
      console.log('\n⚠️  No models found that support generateContent');
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    if (error.message.includes('API_KEY_INVALID') || error.message.includes('API key not valid')) {
      console.error('\n💡 Your API key is invalid. Get a new one at:');
      console.error('   https://makersuite.google.com/app/apikey');
    } else if (error.message.includes('403')) {
      console.error('\n💡 API key permissions issue. Check:');
      console.error('   1. Is the API key enabled?');
      console.error('   2. Do you have billing enabled?');
      console.error('   3. Is the Generative Language API enabled in your project?');
    }
    
    console.error('\nFull Error:', error);
    process.exit(1);
  }
}

listAvailableModels();
