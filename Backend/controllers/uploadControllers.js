const cloudinary = require("../config/cloudinary");
const User = require("../models/userModels");

exports.uploadUserImage = async (req, res) => {
  try {
    // ✅ Check file
    if (!req.file) {
      return res.status(400).json({ message: "Image required" });
    }

    // ✅ Convert buffer → base64 (NO local file)
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // ✅ Upload directly to Cloudinary
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: "AyurSutra/Users",   // auto-create folder
      resource_type: "image",
    });

    // ✅ Save Cloudinary URL only
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        photo: result.secure_url,  // frontend display
        photoPublicId: result.public_id, // optional (for delete/update)
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      public_id: result.public_id,
      user,
    });

  } catch (error) {
    console.error("Cloudinary upload error:", error);
    res.status(500).json({ message: "Upload failed" });
  }
};


