// utils/razorpayHandler.js - Updated
export const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => {
      resolve(true);
    };
    script.onerror = () => {
      resolve(false);
    };
    document.body.appendChild(script);
  });
};

export const openRazorpayPayment = (orderDetails, onSuccess, onError) => {
  const options = {
    key: orderDetails.key,
    amount: orderDetails.amount,
    currency: orderDetails.currency,
    name: 'Healthcare Clinic',
    description: `Appointment with ${orderDetails.doctorName}`,
    order_id: orderDetails.orderId,
    handler: async function (response) {
      onSuccess(response);
    },
    prefill: {
      name: orderDetails.patientName,
      email: orderDetails.patientEmail,
      contact: orderDetails.patientPhone,
    },
    notes: {
      appointmentId: orderDetails.appointmentId,
      patientId: orderDetails.patientId
    },
    theme: {
      color: '#2563eb'
    },
    modal: {
      ondismiss: function() {
        onError('Payment cancelled by user');
      }
    }
  };

  const rzp = new window.Razorpay(options);
  rzp.open();
};