// Direct HTTP test to check API key and available models
require('dotenv').config();
const https = require('https');

const API_KEY = process.env.GEMINI_API_KEY;

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: JSON.parse(data)
        });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function testAPI() {
  console.log('🔍 Testing Gemini API Key with direct HTTP request...\n');
  
  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY not found');
    return;
  }
  
  console.log(`✅ API Key: ${API_KEY.substring(0, 15)}...`);
  console.log('─'.repeat(70));
  
  // Test 1: List models endpoint
  console.log('\n📋 Test 1: Fetching available models...');
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
    const result = await makeRequest(url);
    
    if (result.status === 200 && result.data.models) {
      console.log('✅ Success! Found models:');
      console.log('─'.repeat(70));
      
      result.data.models.forEach(model => {
        const methods = model.supportedGenerationMethods || [];
        if (methods.includes('generateContent')) {
          console.log(`\n✓ ${model.name}`);
          console.log(`  Display: ${model.displayName}`);
          console.log(`  Methods: ${methods.join(', ')}`);
        }
      });
      
      // Show recommended model
      const recommendedModel = result.data.models.find(m => 
        m.name.includes('gemini-1.5-flash') || m.name.includes('gemini-pro')
      );
      
      if (recommendedModel) {
        const modelName = recommendedModel.name.replace('models/', '');
        console.log('\n' + '─'.repeat(70));
        console.log('💡 RECOMMENDED: Update your .env with:');
        console.log(`   GEMINI_MODEL=${modelName}`);
      }
      
    } else {
      console.log(`⚠️  Unexpected response (Status ${result.status}):`, result.data);
    }
    
  } catch (error) {
    console.error('❌ Error listing models:', error.message);
    
    if (error.message.includes('403') || error.message.includes('API_KEY_INVALID')) {
      console.error('\n💡 Your API key has permission issues:');
      console.error('   1. Go to https://aistudio.google.com/app/apikey');
      console.error('   2. Make sure "Generative Language API" is enabled');
      console.error('   3. Check if billing is enabled (if required)');
      console.error('   4. Create a new API key if needed');
    }
  }
  
  // Test 2: Try a simple generation with common models
  console.log('\n\n📝 Test 2: Testing content generation...');
  console.log('─'.repeat(70));
  
  const modelsToTry = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-1.5-pro-latest', 
    'gemini-1.5-pro',
    'gemini-pro'
  ];
  
  for (const model of modelsToTry) {
    try {
      console.log(`\nTrying: ${model}...`);
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      const postData = JSON.stringify({
        contents: [{
          parts: [{ text: 'Say hello' }]
        }]
      });
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const result = await new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              data: data ? JSON.parse(data) : {}
            });
          });
        });
        
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
      
      if (result.status === 200) {
        console.log(`✅ SUCCESS! Model "${model}" is working!`);
        console.log('─'.repeat(70));
        console.log('\n🎉 Update your .env file with:');
        console.log(`   GEMINI_MODEL=${model}`);
        console.log('\n✨ Your Gemini API is ready to use!\n');
        return;
      } else if (result.status === 404) {
        console.log(`  ✗ Not available (404)`);
      } else {
        console.log(`  ✗ Error ${result.status}:`, result.data.error?.message || 'Unknown');
      }
      
    } catch (error) {
      console.log(`  ✗ Failed:`, error.message);
    }
  }
  
  console.log('\n❌ No working models found.');
  console.log('\n💡 Next steps:');
  console.log('   1. Visit https://aistudio.google.com/app/apikey');
  console.log('   2. Create a new API key');
  console.log('   3. Make sure you accept the terms and enable the API');
  console.log('   4. Update GEMINI_API_KEY in your .env file\n');
}

testAPI();
