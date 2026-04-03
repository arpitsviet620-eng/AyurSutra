const express = require("express");
const router = express.Router();

const Notification = require("../models/notificationModels");
const { protect } = require("../middleware/authMiddleware");

/* GET NOTIFICATIONS (alias) */
router.get("/me", protect, async (req, res) => {
  const limit = Number(req.query.limit) || 15;

  const notifications = await Notification.find({
    "recipients.user": req.user._id
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json({ success: true, notifications });
});


/* UNREAD COUNT */
router.get("/unread-count", protect, async (req, res) => {
  const count = await Notification.countDocuments({
    "recipients.user": req.user._id,
    "recipients.read": false
  });

  res.json({ success: true, count });
});

/* MARK ONE AS READ */
router.patch("/:id/read", protect, async (req, res) => {
  await Notification.updateOne(
    { _id: req.params.id, "recipients.user": req.user._id },
    {
      $set: {
        "recipients.$.read": true,
        "recipients.$.readAt": new Date()
      }
    }
  );

  res.json({ success: true });
});

/* MARK ALL AS READ */
router.patch("/read-all", protect, async (req, res) => {
  await Notification.updateMany(
    { "recipients.user": req.user._id },
    {
      $set: {
        "recipients.$[].read": true,
        "recipients.$[].readAt": new Date()
      }
    }
  );

  res.json({ success: true });
});

module.exports = router;
