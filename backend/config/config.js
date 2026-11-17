require('dotenv').config();



module.exports = {
    port: process.env.PORT || 4050,
    // openaiApiKey: process.env.OPENAI_API_KEY,
    // defaultDbConnection: process.env.DEFAULT_DB_CONNECTION,

    defaultDbConnection: process.env.DEFAULT_DB_CONNECTION,
    hfApiKey: process.env.HF_API_KEY,
  };


//This file loads and exports environment variables so that you can access them in your app.