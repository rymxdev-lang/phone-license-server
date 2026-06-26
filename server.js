const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

console.log("SERVER START TIME:", new Date().toISOString());

const ADMIN_SECRET = process.env.ADMIN_SECRET;



function checkAdmin(req, res) {

  const adminSecret = req.headers["x-admin-secret"];

  if (adminSecret !== ADMIN_SECRET) {
    res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
    return false;
  }

  return true;
}

function generateLicense() {
  return (
    "PHN-" +
    Math.random().toString(36).substring(2, 6).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 6).toUpperCase()
  );
}


console.log('DB_HOST=', process.env.DB_HOST);
console.log('DB_PORT=', process.env.DB_PORT);
console.log('DB_NAME=', process.env.DB_NAME);
console.log('DB_USER=', process.env.DB_USER);


const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});
pool.query('SELECT NOW()', (err, res) => {

  if (err) {
    console.error('POSTGRES ERROR:', err);
  } else {
    console.log('POSTGRES CONNECTED');
    console.log(res.rows[0]);
  }

});

app.get("/", (req, res) => {
  res.send("License Server Running");
});

app.post("/create-client", async (req, res) => {
  console.log("CREATE CLIENT CALLED");
  console.log(req.body);
  if (!checkAdmin(req, res)) return;

  const { client_name } = req.body;

  const license = generateLicense();

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 5);

  try {

    await pool.query(
      `
      INSERT INTO clients
      (client_name, license_key, status, trial_end)
      VALUES ($1,$2,$3,$4)
      `,
      [
        client_name,
        license,
        "trial",
        trialEnd.toISOString()
      ]
    );

    res.json({
      success: true,
      client_name,
      license_key: license,
      status: "trial",
      trial_end: trialEnd.toISOString()
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success:false,
      error:err.message
    });

  }

});

app.post(["/check-license", "/api/license/check", "/api/check-license"], async (req, res) => {
  const licenseKey = req.body.license_key || req.body.licenseKey || req.body.key;
  const deviceId = req.body.device_id || req.body.deviceId;

console.log("LICENSE RECEIVED =", licenseKey);
const result = await pool.query(
  "SELECT * FROM clients WHERE license_key = $1",
  [licenseKey]
);
console.log("ROWS =", result.rows);
const row = result.rows[0];
  

      if (!row) {
        return res.json({
          valid: false,
          success: false,
          message: "License not found"
        });
      }

      if (row.status === "suspended") {
        return res.json({
          valid: false,
          success: false,
          message: "Account suspended"
        });
      }

      // Check trial expiration
      if (row.status === "trial" && row.trial_end) {
        const now = new Date();
        const trialEnd = new Date(row.trial_end);

        if (now > trialEnd) {
          // Use a callback to handle the update properly
await pool.query(
  "UPDATE clients SET status='suspended' WHERE license_key=$1",
  [licenseKey]
);

return res.json({
  valid: false,
  success: false,
  message: "Trial expired. Please contact support."
});
        }
      }

if (!row.device_id && deviceId) {

  await pool.query(
    "UPDATE clients SET device_id=$1 WHERE license_key=$2",
    [deviceId, licenseKey]
  );

  return res.json({
    valid: true,
    success: true,
    message: "License activated",
    client_name: row.client_name,
    status: row.status
  });

}

      // Check if license is already used on another device
      if (row.device_id && deviceId && row.device_id !== deviceId) {
        return res.json({
          valid: false,
          success: false,
          message: "License already used on another device"
        });
      }

      // License is valid
      return res.json({
        valid: true,
        success: true,
        message: "License valid",
        client_name: row.client_name,
        status: row.status,
        trial_end: row.trial_end
      });
    

});

app.post("/activate-client", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  const { license_key } = req.body;

  try {

    await pool.query(
      "UPDATE clients SET status='active' WHERE license_key=$1",
      [license_key]
    );

    res.json({
      success:true,
      message:"Client activated"
    });

  } catch(err){

    res.status(500).json({
      success:false,
      error:err.message
    });

  }

});

app.post("/suspend-client", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  const { license_key } = req.body;

  try {

    await pool.query(
      "UPDATE clients SET status='suspended' WHERE license_key=$1",
      [license_key]
    );

    res.json({
      success:true,
      message:"Client suspended"
    });

  } catch(err){

    res.status(500).json({
      success:false,
      error:err.message
    });

  }

});
app.post("/delete-client", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  const { license_key } = req.body;

  try {

    await pool.query(
      "DELETE FROM clients WHERE license_key=$1",
      [license_key]
    );

    res.json({
      success:true,
      message:"Client deleted"
    });

  } catch(err){

    res.status(500).json({
      success:false,
      error:err.message
    });

  }

});

app.post("/reset-device", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  const { license_key } = req.body;

  try {

    await pool.query(
      "UPDATE clients SET device_id=NULL WHERE license_key=$1",
      [license_key]
    );

    res.json({
      success:true,
      message:"Device reset successfully"
    });

  } catch(err){

    res.status(500).json({
      success:false,
      error:err.message
    });

  }

});



app.get("/clients", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  try {

    const result = await pool.query(
      "SELECT * FROM clients ORDER BY id DESC"
    );

    res.json(result.rows);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});