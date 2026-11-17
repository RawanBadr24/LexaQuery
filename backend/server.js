// The main entry point that sets up the Express server, middleware, and routes.


const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { port } = require('./config/config');
const queryRoutes = require('./routes/query');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/query', queryRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
