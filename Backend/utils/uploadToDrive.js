const fs = require("fs");
const drive = require("../config/cloudinary");

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "1ORDXdBWgJjmRbBpf-cPrQhP-D94D7BTZ";

module.exports = async (file) => {
  const response = await drive.files.create({
    supportsAllDrives: true,              // ✅ REQUIRED
    requestBody: {
      name: file.filename,
      parents: [DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    },
  });

  await drive.permissions.create({
    supportsAllDrives: true,               // ✅ REQUIRED
    fileId: response.data.id,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return {
    fileId: response.data.id,
    viewLink: `https://drive.google.com/uc?id=${response.data.id}`,
  };
};
