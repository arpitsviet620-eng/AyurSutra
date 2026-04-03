import { useState, useCallback } from 'react';
import { chatService } from '../../../utils/gemini';

export const useChatBot = (initialLanguage = 'English') => {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [language, setLanguage] = useState(initialLanguage);

  const sendMessage = useCallback(async (text) => {
    setIsTyping(true);
    
    try {
      const response = await chatService.getAIResponse(text, language, messages);
      
      const botMessage = {
        id: Date.now(),
        text: response.text,
        sender: 'bot',
        medicines: response.medicines || [],
        timestamp: new Date().toLocaleTimeString()
      };
      
      setMessages(prev => [...prev, botMessage]);
      return botMessage;
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    } finally {
      setIsTyping(false);
    }
  }, [language, messages]);

  return {
    messages,
    setMessages,
    isTyping,
    language,
    setLanguage,
    sendMessage
  };
};