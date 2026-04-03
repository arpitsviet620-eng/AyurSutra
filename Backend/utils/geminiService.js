// utils/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const geminiConfig = require("../config/geminiConfig");

class GeminiService {
  constructor() {
    if (!geminiConfig.API_KEY) {
      throw new Error("Gemini API key is missing in .env file");
    }

    // Initialize the Google Generative AI client
    this.client = new GoogleGenerativeAI(geminiConfig.API_KEY);
    this.modelName = geminiConfig.MODEL;
  }

  async generateContent(prompt, language = "English", isJson = false) {
    try {
      if (!prompt?.trim()) throw new Error("Prompt is required");

      const finalPrompt = `Reply in ${language}. ${prompt}`;

      // Get the generative model
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: isJson ? {
          responseMimeType: "application/json",
        } : undefined,
      });

      // Generate content
      const result = await model.generateContent(finalPrompt);
      const response = result.response;
      const text = response.text();

      return {
        text: text || "No response generated",
        model: this.modelName,
        success: true,
      };
    } catch (error) {
      this._handleError(error);
    }
  }

  async generateMedicalAdvice(symptoms, language = "English") {
    const prompt = `You are an expert Ayurveda practitioner and consultant. Provide Ayurvedic advice ONLY for these symptoms: ${symptoms}.

STRICT RULES:
1. Provide ONLY Ayurvedic perspective and treatments
2. Explain according to Ayurvedic principles (Doshas: Vata, Pitta, Kapha)
3. Suggest ONLY Ayurvedic herbs, remedies, and treatments
4. Do NOT suggest modern/allopathic medicines

Include:
- Possible causes according to Ayurveda (Dosha imbalance)
- Ayurvedic home remedies and herbs
- Dietary recommendations (Ayurvedic diet)
- Lifestyle modifications (Ayurvedic lifestyle)
- When to consult an Ayurvedic doctor
- Precautions as per Ayurveda`;
    return await this.generateContent(prompt, language, false);
  }

  async generateStructuredMedicalResponse(symptoms, language = "English") {
    const prompt = `
You are an expert Ayurveda practitioner. Provide ONLY Ayurvedic analysis for these symptoms: "${symptoms}".

STRICT RULES:
1. Provide ONLY Ayurvedic perspective
2. Focus on Dosha imbalances and Ayurvedic principles
3. Suggest ONLY Ayurvedic herbs and remedies
4. Do NOT suggest modern/allopathic medicines

Return a valid JSON object with this exact schema:
{
  "dosha_imbalance": "Which Dosha (Vata/Pitta/Kapha) is affected",
  "possible_causes_ayurveda": ["Ayurvedic cause1", "Ayurvedic cause2"],
  "ayurvedic_remedies": ["Ayurvedic herb/remedy1", "Ayurvedic herb/remedy2"],
  "ayurvedic_diet": ["Recommended food1", "Recommended food2"],
  "when_to_consult_ayurvedic_doctor": "description here",
  "precautions_ayurveda": ["Ayurvedic precaution1", "Ayurvedic precaution2"]
}
    `;
    
    try {
      const result = await this.generateContent(prompt, language, true);
      return JSON.parse(result.text);
    } catch (error) {
      console.error("JSON parse error:", error);
      // Return a structured response even if JSON parsing fails
      return {
        dosha_imbalance: "Unable to determine",
        possible_causes_ayurveda: ["Unable to parse response"],
        ayurvedic_remedies: ["Please consult an Ayurvedic doctor"],
        ayurvedic_diet: ["Follow balanced Ayurvedic diet"],
        when_to_consult_ayurvedic_doctor: "Please consult an Ayurvedic doctor for proper diagnosis",
        precautions_ayurveda: ["Seek Ayurvedic consultation"]
      };
    }
  }

  async analyzeAyurvedaMedicineImage(imageData, language = "English") {
    try {
      if (!imageData) {
        throw new Error("Image data is required");
      }

      // Prepare the image data
      let imageBase64 = imageData;
      let mimeType = "image/jpeg";

      // Check if imageData contains base64 prefix and extract it
      if (imageData.includes("base64,")) {
        const parts = imageData.split("base64,");
        const mimeMatch = parts[0].match(/data:(.*?);/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }
        imageBase64 = parts[1];
      }

      // Create Ayurveda-specific prompt
      const ayurvedaPrompt = `
You are an expert Ayurveda medicine specialist. Analyze this image ONLY for Ayurvedic medicines, herbs, or plants.

STRICT RULES:
1. ONLY identify Ayurvedic medicines, herbs, plants, or traditional Ayurvedic products
2. If the image is NOT related to Ayurveda, respond: "This image does not appear to contain Ayurvedic medicine or herbs"
3. Do NOT provide information about modern/allopathic medicines
4. Do NOT provide information about non-Ayurvedic items

Please provide (in ${language} language):
1. Name of the Ayurvedic medicine/herb/plant (Sanskrit and common name)
2. Traditional Ayurvedic properties (Rasa, Guna, Virya, Vipaka, Dosha effects)
3. Medicinal benefits according to Ayurveda
4. Traditional uses and preparations
5. Dosage recommendations (as per Ayurvedic texts)
6. Precautions and contraindications
7. Related Ayurvedic formulations if applicable

Remember: ONLY respond if this is Ayurveda-related. Otherwise, state that it's not Ayurvedic medicine.
      `;

      // Get the generative model with vision capability
      const model = this.client.getGenerativeModel({
        model: "gemini-1.5-flash" // Using vision-capable model
      });

      // Prepare the image part
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType
        }
      };

      // Generate content with image and text
      const result = await model.generateContent([ayurvedaPrompt, imagePart]);
      const response = result.response;
      const text = response.text();

      return {
        text: text || "Unable to analyze the image",
        model: "gemini-1.5-flash",
        success: true,
        language: language
      };
    } catch (error) {
      this._handleError(error);
    }
  }

  _handleError(error) {
    console.error("Gemini Service Error:", error);

    // Check for specific error types
    if (error.message && error.message.includes("API_KEY_INVALID")) {
      throw new Error("Invalid Gemini API key. Please check your .env file.");
    }

    // 404 Fix: If the model is not found
    if (error.status === 404 || (error.message && error.message.includes("404"))) {
      throw new Error(`The model ${this.modelName} is not available. Try 'gemini-2.0-flash-exp' or 'gemini-1.5-flash'.`);
    }
    
    // Quota exceeded
    if (error.status === 429 || (error.message && error.message.includes("429"))) {
      throw new Error("Quota exceeded. Please wait before trying again.");
    }

    // Billing or permission issues
    if (error.message && (error.message.includes("billing") || error.message.includes("permission"))) {
      throw new Error("API key billing or permission issue. Check Google AI Studio settings.");
    }

    throw new Error(error.message || "AI service temporarily unavailable.");
  }
}

module.exports = new GeminiService();