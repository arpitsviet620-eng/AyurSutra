// utils/notificationHelper.js
const Notification = require('../models/notificationModels');
const User = require('../models/userModels');
const Appointment = require('../models/appointmentModels');
const Doctor = require('../models/doctorModels');
const Patient = require('../models/patientModels');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// SMS client setup
const smsClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

class NotificationHelper {
  
  // ============================
  // CREATE NOTIFICATION
  // ============================
  static async createNotification({
    type,
    title,
    message,
    detailedMessage = '',
    triggeredBy,
    recipients, // Array of { userId, role, deliveryMethods }
    relatedTo,
    appointmentData,
    priority = 'medium',
    category = 'appointment',
    sendEmail = true,
    sendSMS = false,
    scheduledFor = null
  }) {
    try {
      // Prepare recipients with delivery methods
      const preparedRecipients = await Promise.all(
        recipients.map(async (recipient) => {
          const user = await User.findById(recipient.userId);
          const deliveryMethods = recipient.deliveryMethods || ['in_app'];
          
          // Auto-detect email/SMS based on user preferences
          if (sendEmail && user.email) {
            if (!deliveryMethods.includes('email')) {
              deliveryMethods.push('email');
            }
          }
          
          if (sendSMS && user.phone) {
            if (!deliveryMethods.includes('sms')) {
              deliveryMethods.push('sms');
            }
          }
          
          return {
            user: recipient.userId,
            role: recipient.role || user.role,
            deliveryMethod: deliveryMethods,
            status: 'pending'
          };
        })
      );
      
      // Prepare email and SMS data if needed
      let emailData = null;
      let smsData = null;
      
      if (sendEmail || sendSMS) {
        const templateData = await this.prepareTemplateData({
          type,
          title,
          message,
          detailedMessage,
          appointmentData,
          recipients: preparedRecipients
        });
        
        if (sendEmail) {
          emailData = {
            subject: templateData.emailSubject,
            template: type,
            variables: templateData.variables
          };
        }
        
        if (sendSMS) {
          smsData = {
            template: type,
            variables: templateData.smsVariables
          };
        }
      }
      
      // Create notification
      const notification = await Notification.create({
        type,
        title,
        message,
        detailedMessage,
        triggeredBy,
        recipients: preparedRecipients,
        relatedTo,
        appointmentData,
        emailData,
        smsData,
        priority,
        category,
        scheduledFor
      });
      
      // Send notifications asynchronously
      this.sendNotifications(notification);
      
      return notification;
      
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }
  
  // ============================
  // PREPARE TEMPLATE DATA
  // ============================
  static async prepareTemplateData(data) {
    const { type, appointmentData } = data;
    
    const variables = {
      title: data.title,
      message: data.message,
      detailedMessage: data.detailedMessage,
      date: new Date().toLocaleDateString('en-IN'),
      time: new Date().toLocaleTimeString('en-IN'),
      currentYear: new Date().getFullYear()
    };
    
    // Add appointment specific variables
    if (appointmentData) {
      Object.assign(variables, {
        appointmentId: appointmentData.appointmentId,
        appointmentDate: new Date(appointmentData.date).toLocaleDateString('en-IN'),
        appointmentTime: appointmentData.time,
        doctorName: appointmentData.doctorName,
        patientName: appointmentData.patientName,
        consultationFee: appointmentData.consultationFee,
        location: appointmentData.location || 'Clinic',
        department: appointmentData.department,
        cancellationReason: appointmentData.cancellationReason
      });
    }
    
    // Type-specific email subjects
    const emailSubjects = {
      'appointment_created': `Appointment Confirmation - ${variables.appointmentId}`,
      'appointment_confirmed': `Appointment Confirmed - ${variables.appointmentId}`,
      'appointment_cancelled': `Appointment Cancelled - ${variables.appointmentId}`,
      'appointment_rescheduled': `Appointment Rescheduled - ${variables.appointmentId}`,
      'appointment_reminder': `Appointment Reminder - ${variables.appointmentId}`,
      'appointment_completed': `Appointment Completed - ${variables.appointmentId}`
    };
    
    return {
      emailSubject: emailSubjects[type] || data.title,
      variables,
      smsVariables: {
        ...variables,
        message: data.message.substring(0, 140) // Trim for SMS
      }
    };
  }
  
  // ============================
  // SEND NOTIFICATIONS
  // ============================
  static async sendNotifications(notification) {
    try {
      // Process each recipient
      for (const recipient of notification.recipients) {
        // Send in-app notification (always)
        await this.sendInAppNotification(notification, recipient);
        
        // Send email if configured
        if (recipient.deliveryMethod.includes('email')) {
          await this.sendEmailNotification(notification, recipient);
        }
        
        // Send SMS if configured
        if (recipient.deliveryMethod.includes('sms')) {
          await this.sendSMSNotification(notification, recipient);
        }
      }
      
      // Update notification status
      notification.recipients.forEach(r => {
        if (r.status === 'pending') {
          r.status = 'sent';
        }
      });
      
      await notification.save();
      
    } catch (error) {
      console.error('Error sending notifications:', error);
    }
  }
  
  // ============================
  // SEND IN-APP NOTIFICATION
  // ============================
  static async sendInAppNotification(notification, recipient) {
    try {
      // Update recipient status
      recipient.status = 'sent';
      // Note: In-app delivery is immediate
    } catch (error) {
      console.error('Error sending in-app notification:', error);
      recipient.status = 'failed';
    }
  }
  
  // ============================
  // SEND EMAIL NOTIFICATION
  // ============================
  static async sendEmailNotification(notification, recipient) {
    try {
      const user = await User.findById(recipient.user);
      
      if (!user || !user.email) {
        recipient.emailSent = false;
        return;
      }
      
      const emailContent = await this.generateEmailContent(notification, user);
      
      const mailOptions = {
        from: `"Clinic Management" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      };
      
      await transporter.sendMail(mailOptions);
      
      recipient.emailSent = true;
      recipient.emailSentAt = new Date();
      
    } catch (error) {
      console.error('Error sending email:', error);
      recipient.emailSent = false;
    }
  }
  
  // ============================
  // SEND SMS NOTIFICATION
  // ============================
  static async sendSMSNotification(notification, recipient) {
    try {
      const user = await User.findById(recipient.user);
      
      if (!user || !user.phone) {
        recipient.smsSent = false;
        return;
      }
      
      const smsContent = await this.generateSMSContent(notification, user);
      
      await smsClient.messages.create({
        body: smsContent,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `+91${user.phone}`
      });
      
      recipient.smsSent = true;
      recipient.smsSentAt = new Date();
      
    } catch (error) {
      console.error('Error sending SMS:', error);
      recipient.smsSent = false;
    }
  }
  
  // ============================
  // GENERATE EMAIL CONTENT
  // ============================
  static async generateEmailContent(notification, user) {
    const { type, title, message, detailedMessage, appointmentData } = notification;
    
    let subject = title;
    let html = '';
    
    // Appointment created/confirmed email template
    if (type === 'appointment_created' || type === 'appointment_confirmed') {
      subject = `Appointment ${type === 'appointment_created' ? 'Booked' : 'Confirmed'} - ${appointmentData.appointmentId}`;
      
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb; }
            .detail-row { display: flex; margin-bottom: 10px; }
            .detail-label { font-weight: bold; width: 150px; color: #666; }
            .detail-value { flex: 1; }
            .button { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Appointment ${type === 'appointment_created' ? 'Booked Successfully' : 'Confirmed'}</h1>
            </div>
            <div class="content">
              <p>Dear ${appointmentData.patientName},</p>
              <p>${message}</p>
              
              <div class="details">
                <h3>Appointment Details:</h3>
                <div class="detail-row">
                  <div class="detail-label">Appointment ID:</div>
                  <div class="detail-value"><strong>${appointmentData.appointmentId}</strong></div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Doctor:</div>
                  <div class="detail-value">${appointmentData.doctorName}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Department:</div>
                  <div class="detail-value">${appointmentData.department}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Date:</div>
                  <div class="detail-value">${new Date(appointmentData.date).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Time:</div>
                  <div class="detail-value">${appointmentData.time}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Consultation Fee:</div>
                  <div class="detail-value">₹${appointmentData.consultationFee}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Location:</div>
                  <div class="detail-value">${appointmentData.location || 'Clinic Reception'}</div>
                </div>
              </div>
              
              <p><strong>Please Note:</strong></p>
              <ul>
                <li>Arrive 15 minutes before your appointment time</li>
                <li>Carry your previous medical reports if any</li>
                <li>Bring a valid ID proof</li>
                <li>Payment can be made at the clinic reception</li>
              </ul>
              
              <p>For any queries or to reschedule/cancel, please contact:</p>
              <p>📞 Clinic Reception: +91-XXXXXXXXXX<br>
              📧 Email: support@clinic.com</p>
              
              <a href="${process.env.APP_URL}/appointments/${notification.relatedTo.id}" class="button">View Appointment Details</a>
            </div>
            
            <div class="footer">
              <p>This is an automated email. Please do not reply to this email.</p>
              <p>© ${new Date().getFullYear()} Your Clinic Name. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;
    }
    // Appointment cancelled email template
    else if (type === 'appointment_cancelled') {
      subject = `Appointment Cancelled - ${appointmentData.appointmentId}`;
      
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            /* Same styles as above */
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header" style="background: #ef4444;">
              <h1>Appointment Cancelled</h1>
            </div>
            <div class="content">
              <p>Dear ${appointmentData.patientName},</p>
              <p>${message}</p>
              
              <div class="details">
                <h3>Cancelled Appointment Details:</h3>
                <div class="detail-row">
                  <div class="detail-label">Appointment ID:</div>
                  <div class="detail-value"><strong>${appointmentData.appointmentId}</strong></div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Doctor:</div>
                  <div class="detail-value">${appointmentData.doctorName}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Original Date:</div>
                  <div class="detail-value">${new Date(appointmentData.date).toLocaleDateString('en-IN')}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Original Time:</div>
                  <div class="detail-value">${appointmentData.time}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Cancellation Reason:</div>
                  <div class="detail-value">${appointmentData.cancellationReason || 'Not specified'}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Cancelled On:</div>
                  <div class="detail-value">${new Date().toLocaleString('en-IN')}</div>
                </div>
              </div>
              
              <p><strong>Refund Information:</strong></p>
              <ul>
                <li>Refunds will be processed within 5-7 business days</li>
                <li>The amount will be credited to your original payment method</li>
                <li>You will receive a confirmation email once refund is processed</li>
              </ul>
              
              <p>To book a new appointment, click below:</p>
              <a href="${process.env.APP_URL}/book-appointment" class="button">Book New Appointment</a>
              
              <p>For any queries, please contact:</p>
              <p>📞 Clinic Reception: +91-XXXXXXXXXX<br>
              📧 Email: support@clinic.com</p>
            </div>
            
            <div class="footer">
              <p>This is an automated email. Please do not reply to this email.</p>
              <p>© ${new Date().getFullYear()} Your Clinic Name. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;
    }
    // Generic notification template
    else {
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            /* Simplified styles for generic emails */
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px;">
              <h1>${title}</h1>
            </div>
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
              <p>${message}</p>
              ${detailedMessage ? `<p>${detailedMessage}</p>` : ''}
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #666; font-size: 12px;">
                <p>© ${new Date().getFullYear()} Your Clinic Name</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;
    }
    
    return {
      subject,
      html,
      text: `${message}\n\n${detailedMessage}`
    };
  }
  
  // ============================
  // GENERATE SMS CONTENT
  // ============================
  static async generateSMSContent(notification, user) {
    const { type, message, appointmentData } = notification;
    
    if (type === 'appointment_created') {
      return `Appointment booked with Dr. ${appointmentData.doctorName} on ${new Date(appointmentData.date).toLocaleDateString('en-IN')} at ${appointmentData.time}. ID: ${appointmentData.appointmentId}. Arrive 15 mins early.`;
    } else if (type === 'appointment_confirmed') {
      return `Your appointment with Dr. ${appointmentData.doctorName} is confirmed for ${new Date(appointmentData.date).toLocaleDateString('en-IN')} at ${appointmentData.time}. ID: ${appointmentData.appointmentId}`;
    } else if (type === 'appointment_cancelled') {
      return `Appointment ${appointmentData.appointmentId} with Dr. ${appointmentData.doctorName} has been cancelled. Refund will be processed in 5-7 days.`;
    }
    
    return message.substring(0, 140);
  }
  
  // ============================
  // MARK NOTIFICATION AS READ
  // ============================
  static async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findById(notificationId);
      
      if (!notification) {
        throw new Error('Notification not found');
      }
      
      const recipient = notification.recipients.find(
        r => r.user.toString() === userId.toString()
      );
      
      if (recipient && !recipient.read) {
        recipient.read = true;
        recipient.readAt = new Date();
        recipient.status = 'read';
        await notification.save();
      }
      
      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }
  
  // ============================
  // GET USER NOTIFICATIONS
  // ============================
  static async getUserNotifications(userId, options = {}) {
    const {
      limit = 20,
      page = 1,
      unreadOnly = false,
      type,
      category
    } = options;
    
    const skip = (page - 1) * limit;
    
    const query = {
      'recipients.user': userId,
      isArchived: false
    };
    
    if (unreadOnly) {
      query['recipients.read'] = false;
    }
    
    if (type) {
      query.type = type;
    }
    
    if (category) {
      query.category = category;
    }
    
    const notifications = await Notification.find(query)
      .populate('triggeredBy', 'name email')
      .populate('relatedTo.id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Filter to only show recipient's specific data
    const filteredNotifications = notifications.map(notification => {
      const recipientData = notification.recipients.find(
        r => r.user.toString() === userId.toString()
      );
      
      return {
        ...notification,
        recipientData,
        read: recipientData?.read || false,
        readAt: recipientData?.readAt
      };
    });
    
    const total = await Notification.countDocuments(query);
    
    return {
      notifications: filteredNotifications,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    };
  }
  
  // ============================
  // SEND APPOINTMENT REMINDERS
  // ============================
  static async sendAppointmentReminders() {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(23, 59, 59, 999);
      
      // Find tomorrow's appointments
      const appointments = await Appointment.find({
        date: { $gte: tomorrow, $lte: tomorrowEnd },
        status: { $in: ['scheduled', 'confirmed'] }
      })
      .populate({
        path: 'patient',
        select: 'user patientCode',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate({
        path: 'doctor',
        select: 'user doctorId department',
        populate: { path: 'user', select: 'name email phone' }
      });
      
      for (const appointment of appointments) {
        // Send reminder to patient
        await this.createNotification({
          type: 'appointment_reminder',
          title: 'Appointment Reminder',
          message: `Reminder: Your appointment with Dr. ${appointment.doctor.user.name} is tomorrow at ${appointment.time}`,
          triggeredBy: appointment.doctor.user._id,
          recipients: [
            {
              userId: appointment.patient.user._id,
              role: 'patient',
              deliveryMethods: ['in_app', 'email', 'sms']
            }
          ],
          relatedTo: { model: 'Appointment', id: appointment._id },
          appointmentData: {
            appointmentId: appointment.appointmentId,
            date: appointment.date,
            time: appointment.time,
            doctorName: appointment.doctor.user.name,
            patientName: appointment.patient.user.name,
            department: appointment.doctor.department
          },
          sendEmail: true,
          sendSMS: true,
          scheduledFor: appointment.date
        });
        
        // Also send reminder to doctor
        await this.createNotification({
          type: 'appointment_reminder',
          title: 'Appointment Schedule',
          message: `You have an appointment with ${appointment.patient.user.name} tomorrow at ${appointment.time}`,
          triggeredBy: appointment.patient.user._id,
          recipients: [
            {
              userId: appointment.doctor.user._id,
              role: 'doctor',
              deliveryMethods: ['in_app']
            }
          ],
          relatedTo: { model: 'Appointment', id: appointment._id },
          appointmentData: {
            appointmentId: appointment.appointmentId,
            date: appointment.date,
            time: appointment.time,
            doctorName: appointment.doctor.user.name,
            patientName: appointment.patient.user.name
          },
          sendEmail: false,
          sendSMS: false
        });
      }
      
      console.log(`Sent reminders for ${appointments.length} appointments`);
      
    } catch (error) {
      console.error('Error sending appointment reminders:', error);
    }
  }
}

module.exports = NotificationHelper;