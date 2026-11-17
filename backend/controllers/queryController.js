// This controller receives the request from the route, builds the prompt, 
// calls the service to generate SQL, and then simulates executing the query.

//  controller now uses the user-supplied connection string (or falls back to the default) 
// and applies the generated SQL query to the PostgreSQL database. Only queries starting with SELECT are allowed.

// const { generateSQL } = require('../services/openaiService');
// const { Client } = require('pg');
// const { defaultDbConnection } = require('../config/config');
// const { getDatabaseSchema } = require('../utils/dbSchema');

/**
 * Handles the /query POST request.
 * It takes the natural language query, creates a prompt, generates an SQL query,
 * connects to the provided (or default) database, executes the query, and returns the results.
 */
// async function handleQuery(req, res) {
//   try {
//     const { nlQuery, dbConnection } = req.body;
    
//     // Use user-supplied connection string or fallback to default
//     const connectionString = dbConnection || defaultDbConnection;

    
//     // Dynamically generate the schema description from the database.
//     const schemaInfo = await getDatabaseSchema(connectionString);

//     const prompt = `Convert the following natural language request into sql query.
// Return ONLY the SQL query with no explanations, comments, or formatting.
// Ensure the query is correct based on this database schema:

// ${schemaInfo}

// User request: "${nlQuery}"

// SQL Query:
// `;


//     // Get the generated SQL query from the OpenAI service.

//     const result = await generateSQL(prompt);
//     return res.status(200).json(result);

//     console.log("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"+ generatedSQL);
    
//     // // SECURITY CHECK: Allow only SELECT queries
//     // if (!generatedSQL.trim().toLowerCase().startsWith('select')) {
//     //   return res.status(400).json({ error: 'Only SELECT queries are allowed for safety.' });
//     // }

//     // Connect to the PostgreSQL database and execute the query.
//     const client = new Client({ connectionString });
//     await client.connect();
//     const queryResult = await client.query(generatedSQL);
//     await client.end();

//     // Return both the generated SQL and the query result rows.
//     res.json({ sql: generatedSQL, result: queryResult.rows });
//   }catch (error) {
//     console.error("Error in /query endpoint:", error);
//     res.status(500).json({ error: 'Internal Server Error', details: error.message });
//   }
// }

// module.exports = { handleQuery };

//////salma's edit


// const { generateSQL } = require('../services/openaiService');
// const { classifyPrompt } = require('../services/classifyPrompt');
// const { Client } = require('pg');
// const { defaultDbConnection } = require('../config/config');

// async function handleQuery(req, res) {
//   try {
//     const { nlQuery, dbConnection } = req.body;
//     const connectionString = dbConnection || defaultDbConnection;

//     // 1️⃣ Step 1: Check if prompt is safe BEFORE doing anything
//     const isSafe = await classifyPrompt(nlQuery);
//     if (!isSafe) {
//       console.log("❌ Unsafe or invalid query detected.");
//       return res.status(200).json({
//         error: true,
//         message: "❌ Sorry, I can't do or answer this request. Anything else? 🙂"
//       });
//     }


//     // 3️⃣ Step 3: Build prompt with schema
//     const prompt = `Convert the following natural language request into an SQL query.
// Return ONLY the SQL query with no explanations, comments, or formatting.

// User request: "${nlQuery}"

// SQL Query:
// `;

//     // 4️⃣ Step 4: Generate SQL using Hugging Face or model
//     const result = await generateSQL(prompt);

//     if (result.error === true) {
//       return res.status(200).json(result);
//     }

//     const generatedSQL = result.sql;
//     console.log("✅ Generated SQL:", generatedSQL);

//     // 5️⃣ Step 5: Optional safety check
//     if (!generatedSQL.trim().toLowerCase().startsWith('select')) {
//       return res.status(200).json({
//         error: true,
//         message: '❗ Only SELECT queries are allowed for safety.'
//       });
//     }

//     // 6️⃣ Step 6: Execute SQL on DB
//     const client = new Client({ connectionString });
//     await client.connect();
//     const queryResult = await client.query(generatedSQL);
//     await client.end();

//     return res.status(200).json({
//       error: false,
//       sql: generatedSQL,
//       result: queryResult.rows
//     });

//   } catch (error) {
//     console.error("Error in /query endpoint:", error);
//     res.status(500).json({ error: true, message: 'Internal Server Error', details: error.message });
//   }
// }

// module.exports = { handleQuery };


//trial 3

const { generateSQL } = require('../services/openaiService');
const { classifyPrompt } = require('../services/classifyPrompt');

async function handleQuery(req, res) {
  try {
    const { nlQuery } = req.body;

    // Step 1: Check if the prompt is safe BEFORE doing anything.
    const isSafe = await classifyPrompt(nlQuery);
    if (!isSafe) {
      console.log("❌ Unsafe or invalid query detected.");
      return res.status(200).json({
        error: true,
        message: "❌ Sorry, I can't do or answer this request. Anything else? 🙂"
      });
    }

    // Step 2: Directly pass the nlQuery to generateSQL.
    // We assume that the FastAPI service (main.py) already handles prompt formatting, SQL generation, and execution.
    const result = await generateSQL(nlQuery);

    // Return the FastAPI response to the client.
    return res.status(200).json(result);

  } catch (error) {
    console.error("Error in /query endpoint:", error);
    res.status(500).json({ error: true, message: 'Internal Server Error', details: error.message });
   }

  }
module.exports = { handleQuery };
