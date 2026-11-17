from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import os
import aiomysql
import typesense
import re
import random
import sqlparse
import json
from dotenv import load_dotenv
from transformers import AutoTokenizer, AutoModelForCausalLM, AutoModelForSequenceClassification
import torch
from peft import PeftConfig, PeftModel
import traceback
import logging
import matplotlib.pyplot as plt
import base64
from io import BytesIO

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s"
)
logger = logging.getLogger(__name__)

# Suppress specific loggers
logging.getLogger("accelerate").setLevel(logging.WARNING)
logging.getLogger("transformers").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("aiomysql").setLevel(logging.WARNING)
logging.getLogger("bitsandbytes").setLevel(logging.ERROR)

# Load environment variables
load_dotenv()

app = FastAPI()

# Enable CORS for remote access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class QueryRequest(BaseModel):
    question: str
    db_connection: Optional[str] = None
    connection_type: Optional[str] = "sql"

class SQLResponse(BaseModel):
    sql_query: Optional[str] = ""
    result: List[Dict[str, Any]] = []
    visualization: Optional[str] = None  # Added for base64-encoded image
    message: Optional[str] = None
    error: Optional[bool] = False

class TypesenseResponse(BaseModel):
    typesense_query: Optional[Dict[str, Any]] = None
    result: Dict[str, Any] = {}
    message: Optional[str] = None
    error: Optional[bool] = False

class QueryResponse(BaseModel):
    sql_response: Optional[SQLResponse] = None
    typesense_response: Optional[TypesenseResponse] = None

# Load Qwen model
qwen_tokenizer = AutoTokenizer.from_pretrained("unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit")
qwen_model = AutoModelForCausalLM.from_pretrained("unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit").to("cuda" if torch.cuda.is_available() else "cpu")

# MySQL Database connection pool
async def create_db_pool():
    logger.info("Attempting to create MySQL database pool...")
    db_config = {
        "host": os.getenv("DB_HOST"),
        "port": int(os.getenv("DB_PORT")),
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
        "db": os.getenv("DB_NAME"),
        "autocommit": True
    }

    try:
        logger.info(f"Connecting to MySQL: {db_config['host']}:{db_config['port']}")
        pool = await aiomysql.create_pool(
            minsize=1,
            maxsize=10,
            connect_timeout=30,
            **db_config
        )
        logger.info("MySQL database pool created successfully")
        return pool
    except Exception as e:
        logger.error(f"Failed to create database pool: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to database at {db_config['host']}:{db_config['port']}. Please check your database connection settings."
        )

# Typesense client initialization
def initialize_typesense_client():
    logger.info("Initializing Typesense client...")
    typesense_config = {
        'api_key': os.getenv("TYPESENSE_API_KEY"),
        'nodes': [{
            'host': os.getenv("TYPESENSE_HOST"),
            'port': os.getenv("TYPESENSE_PORT", "443"),
            'protocol': os.getenv("TYPESENSE_PROTOCOL", "https")
        }],
        'connection_timeout_seconds': 2
    }
    if not typesense_config['api_key'] or not typesense_config['nodes'][0]['host']:
        logger.error("Typesense configuration missing API key or host")
        raise HTTPException(status_code=500, detail="Typesense configuration is incomplete.")
    try:
        client = typesense.Client(typesense_config)
        logger.info("Typesense client initialized successfully")
        return client
    except Exception as e:
        logger.error(f"Failed to initialize Typesense client: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to initialize Typesense client.")

# Prompt safety classification
async def load_safety_model():
   logger.info("Loading safety model...")
   try:
       model_path = os.getenv("SAFETY_MODEL_PATH")
       if not model_path:
           raise ValueError("SAFETY_MODEL_PATH environment variable not set")
       
       peft_config = PeftConfig.from_pretrained(model_path)
       base_model = AutoModelForSequenceClassification.from_pretrained(peft_config.base_model_name_or_path)
       model = PeftModel.from_pretrained(base_model, model_path)
       tokenizer = AutoTokenizer.from_pretrained(peft_config.base_model_name_or_path)
       device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
       model = model.to(device)
       model.eval()
       logger.info("Safety model loaded successfully")
       return model, tokenizer
   except Exception as e:
       logger.error(f"Error loading safety model: {str(e)}")
       raise HTTPException(status_code=500, detail="Failed to load safety model.")

def detect_unsafe_prompt(prompt: str, model, tokenizer) -> bool:
    """Classify prompt as safe or unsafe using DistilRoBERTa."""
    try:
        inputs = tokenizer(prompt, return_tensors="pt", truncation=True, padding="max_length")
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        prediction = torch.argmax(outputs.logits, dim=1).item()
        is_safe = prediction == 0
        logger.info(f"Prompt classified as {'safe' if is_safe else 'unsafe'}")
        return not is_safe
    except Exception as e:
        logger.error(f"Error in prompt classification: {str(e)}")
        return True

# Visualization function
def suggest_plot_type_and_title(data: List[Dict[str, Any]]) -> Dict[str, str]:
    prompt = f"""You are a data visualization expert. Suggest a meaningful chart type (prefer pie or line if possible) and a meaningful title.

Data:
{json.dumps(data, indent=2)}

Respond in exactly this JSON format:
{{
  "type": "<chart_type>",
  "title": "<title>"
}}"""
    inputs = qwen_tokenizer(prompt, return_tensors="pt").to(qwen_model.device)
    outputs = qwen_model.generate(**inputs, max_new_tokens=256)
    response_text = qwen_tokenizer.decode(outputs[0], skip_special_tokens=True)
    try:
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        return json.loads(response_text[json_start:json_end])
    except:
        return {"type": "bar", "title": "Auto Visualization"}

def visualize_sql_result(data: List[Dict[str, Any]], sql_query: str) -> Optional[str]:
    if not data or not isinstance(data, list) or not data[0]:
        return None

    # Handle single-column results (show as count)
    if len(data[0].keys()) == 1:
        key = list(data[0].keys())[0]
        counts = {row[key]: 1 for row in data}
        data = [{"label": k, "count": v} for k, v in counts.items()]
    
    try:
        suggestion = suggest_plot_type_and_title(data)
        plot_type = suggestion.get("type", "bar")
        title = suggestion.get("title", "Data Visualization")

        plt.figure(figsize=(10, 6))
        keys = list(data[0].keys())
        x_key = keys[0]
        y_key = keys[1] if len(keys) > 1 else None

        # Handle single column case
        if not y_key:
            x_vals = [str(row[x_key]) for row in data]
            y_vals = [1] * len(data)  # Default count of 1
            plot_type = 'bar'  # Force bar chart for single column
        else:
            x_vals = [str(row[x_key]) for row in data]
            y_vals = [row[y_key] for row in data]

        if plot_type == 'bar':
            plt.bar(x_vals, y_vals)
        elif plot_type == 'line':
            plt.plot(x_vals, y_vals, marker='o')
        elif plot_type == 'pie':
            plt.pie(y_vals, labels=x_vals, autopct='%1.1f%%')
        elif plot_type == 'histogram':
            plt.hist(y_vals or x_vals, bins=10)
        else:
            plt.bar(x_vals, y_vals)

        plt.title(title)
        if plot_type != 'pie':
            plt.xlabel(x_key)
            if y_key:
                plt.ylabel(y_key)
            else:
                plt.ylabel("Count")

        plt.xticks(rotation=45)
        plt.tight_layout()

        buf = BytesIO()
        plt.savefig(buf, format='png')
        plt.close()
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")
    except Exception as e:
        logger.error(f"Visualization error: {e}")
        return None
# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info("Starting application...")
    try:
        # Initialize database pool
        app.state.db_pool = await create_db_pool()
        logger.info(f"Database pool created: {app.state.db_pool is not None}")

        # Initialize Typesense client
        app.state.typesense_client = initialize_typesense_client()

        # Load Qwen model and tokenizer
        logger.info("Loading Qwen tokenizer...")
        app.state.tokenizer = AutoTokenizer.from_pretrained("unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit")
        logger.info("Qwen tokenizer loaded")

        logger.info("Loading Qwen model...")
        app.state.model = AutoModelForCausalLM.from_pretrained(
            "unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit", device_map="auto"
        )
        logger.info("Qwen model loaded")

        # Load safety model and tokenizer
        app.state.safety_model, app.state.safety_tokenizer = await load_safety_model()

        # Initialize schema cache for MySQL
        app.state.schema_cache = None
        logger.info("Schema cache initialized to None")

        # Fetch MySQL schema cache
        logger.info("Fetching MySQL schema cache during startup...")
        app.state.schema_cache = await get_mysql_schema(force_refresh=True)
        logger.info(f"MySQL schema cache initialized with {len(app.state.schema_cache)} tables")

        # Fetch Typesense schema
        logger.info("Fetching Typesense schema during startup...")
        app.state.typesense_schema = get_typesense_schema()
        logger.info(f"Typesense schema initialized with {len(app.state.typesense_schema)} collections")

        logger.info("Startup complete!")
    except Exception as e:
        logger.error(f"Error during startup: {e}")
        logger.error(traceback.format_exc())
        if hasattr(app.state, 'db_pool') and app.state.db_pool is not None:
            app.state.db_pool.close()
            await app.state.db_pool.wait_closed()
            logger.info("Database pool closed due to startup error")
        raise

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down application...")
    if hasattr(app.state, 'db_pool') and app.state.db_pool is not None:
        app.state.db_pool.close()
        await app.state.db_pool.wait_closed()
        logger.info("Database pool closed")

# MySQL Schema fetching
async def get_mysql_schema(force_refresh=False):
    if app.state.schema_cache and not force_refresh:
        logger.info("Using cached MySQL schema")
        return app.state.schema_cache
    try:
        logger.info("Fetching MySQL database schema...")
        schema = {}
        async with app.state.db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                query = """
                    SELECT TABLE_NAME, COLUMN_NAME 
                    FROM information_schema.columns 
                    WHERE TABLE_SCHEMA = %s
                """
                await cursor.execute(query, [app.state.db_pool._conn_kwargs['db']])
                rows = await cursor.fetchall()
                for row in rows:
                    table_name = row["TABLE_NAME"]
                    column_name = row["COLUMN_NAME"]
                    if table_name not in schema:
                        schema[table_name] = []
                    schema[table_name].append(column_name)
        app.state.schema_cache = schema
        logger.info(f"MySQL schema loaded with {len(schema)} tables")
        return schema
    except Exception as e:
        logger.error(f"MySQL schema loading error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to load MySQL database schema.")

# Typesense Schema fetching
def get_typesense_schema():
    try:
        collections = app.state.typesense_client.collections.retrieve()
        if not collections:
            logger.warning("No collections exist in the Typesense cluster.")
            return []
        logger.info("Typesense schema retrieved successfully")
        return collections
    except Exception as e:
        logger.error(f"Error retrieving Typesense schema: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve Typesense schema.")

# Select Typesense collection from connection string or default
def select_typesense_collection(db_connection: Optional[str] = None):
    schema = get_typesense_schema()
    if not schema:
        logger.error("No Typesense collections found.")
        return None
    
    if db_connection:
        for collection in schema:
            if collection['name'] == db_connection:
                logger.info(f"Selected Typesense collection: {db_connection}")
                return db_connection
        logger.error(f"Invalid Typesense collection name: {db_connection}")
        return None
    
    logger.info(f"Defaulting to Typesense collection: {schema[0]['name']}")
    return schema[0]['name']

# SQL validation and execution
def is_raw_sql_input(user_input: str) -> bool:
    sql_keywords = [
        r"^\s*SELECT\b", r"^\s*INSERT\b", r"^\s*UPDATE\b", r"^\s*DELETE\b", r"^\s*DROP\b",
        r"^\s*ALTER\b", r"^\s*CREATE\b", r"^\s*TRUNCATE\b", r"^\s*WITH\b", r"^\s*REPLACE\b"
    ]
    for pattern in sql_keywords:
        if re.search(pattern, user_input.strip(), re.IGNORECASE):
            return True
    return False

def is_valid_sql(sql_query: str) -> bool:
    if not sql_query:
        return False
    forbidden_keywords = {"INSERT", "UPDATE", "DELETE", "DROP", "ALTER",
                         "TRUNCATE", "CREATE", "GRANT", "REVOKE", "EXEC",
                         "EXECUTE", "COMMIT", "ROLLBACK"}
    for keyword in forbidden_keywords:
        pattern = r'\b' + keyword + r'\b'
        if re.search(pattern, sql_query.upper()):
            logger.info(f"Forbidden keyword detected: {keyword}")
            return False
    parsed = sqlparse.parse(sql_query)
    if not parsed:
        return False
    stmt = parsed[0]
    if stmt.get_type() != "SELECT":
        logger.info(f"Query type is not SELECT: {stmt.get_type()}")
        return False
    return True

async def execute_query(sql_query: str):
    if not is_valid_sql(sql_query):
        logger.info(f"Invalid SQL query detected: {sql_query}")
        return None, True
    try:
        logger.info(f"Executing SQL query: {sql_query}")
        async with app.state.db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(sql_query)
                result = await cursor.fetchall()
                logger.info(f"SQL query returned {len(result)} rows")
                return result, False
    except Exception as e:
        logger.error(f"SQL Execution Error: {str(e)}")
        return f"SQL Execution Error: {str(e)}", True

# Typesense query validation
def validate_typesense_query(query: Dict, question: str) -> Optional[Dict]:
    if not query or not isinstance(query, dict):
        return None
    
    corrected_query = query.copy()
    
    if "q" not in corrected_query:
        corrected_query["q"] = "*"
    
    if "filter_by" in corrected_query:
        if isinstance(corrected_query["filter_by"], list):
            corrected_query["filter_by"] = " && ".join(str(f) for f in corrected_query["filter_by"])
        
        filter_by = str(corrected_query["filter_by"])
        filter_by = re.sub(r'(\w+)\s*=\s*([^&\|]+)', r'\1:=\2', filter_by)
        filter_by = re.sub(r'(\w+)::=', r'\1:=', filter_by)
        filter_by = re.sub(r':\s*=\s*', ':=', filter_by)
        
        def add_quotes(match):
            field, op, value = match.groups()
            if not (value.startswith("'") and value.endswith("'")) and not value.isdigit():
                return f"{field}{op}'{value}'"
            return match.group(0)
        
        filter_by = re.sub(r'(\w+)(:=|>|<|>=|<=)([^&\|]+)', add_quotes, filter_by)
        corrected_query["filter_by"] = filter_by
    
    if "per_page" in corrected_query:
        try:
            per_page = int(corrected_query["per_page"])
            corrected_query["per_page"] = max(1, min(250, per_page))
        except (ValueError, TypeError):
            corrected_query["per_page"] = 250 if "how many" in question.lower() else 10
    else:
        corrected_query["per_page"] = 250 if "how many" in question.lower() else 10
    
    if "sort_by" in corrected_query:
        sort_by = str(corrected_query["sort_by"])
        if not re.match(r'^\w+:(asc|desc)$', sort_by):
            if ":" not in sort_by:
                if "oldest" in question.lower() or "highest" in question.lower():
                    sort_by = f"{sort_by}:desc"
                else:
                    sort_by = f"{sort_by}:asc"
            corrected_query["sort_by"] = sort_by
    
    # Add filter_by for age-specific counting queries
    age_match = re.search(r'age\s+(\d+)', question.lower())
    if age_match and "how many" in question.lower():
        age = age_match.group(1)
        corrected_query["filter_by"] = f"age:={age}"
        corrected_query["q"] = "*"
        if "sort_by" in corrected_query:
            del corrected_query["sort_by"]  # Remove sort_by for counting
    
    if "oldest" in question.lower() or "youngest" in question.lower():
        corrected_query.update({
            "q": "*",
            "sort_by": "age:desc" if "oldest" in question.lower() else "age:asc",
            "per_page": 1
        })
    
    return corrected_query

# Typesense search execution
def perform_typesense_search(collection_name: str, typesense_query: Dict):
    try:
        result = app.state.typesense_client.collections[collection_name].documents.search(typesense_query)
        logger.info(f"Typesense search returned {result['found']} documents")
        return result, False
    except Exception as e:
        logger.error(f"Typesense search error: {str(e)}")
        return {"error": str(e)}, True

# Query classification and SQL generation
async def classify_query_with_qwen(user_input: str, tokenizer, model, schema_info: Dict, connection_type: str) -> str:
    logger.info(f"Classifying query with Qwen: {user_input}")
    if connection_type == "sql":
        schema_text = "\n".join(f"Table: {table}\nColumns: {', '.join(columns)}\n" 
                               for table, columns in schema_info.items())
    else:
        schema_text = json.dumps([coll for coll in schema_info if coll['name'] == select_typesense_collection()], indent=2)
    
    prompt = f"""You are a query classifier for a {'MySQL' if connection_type == 'sql' else 'Typesense'} database. Classify the user input as:
- 'casual': Non-query greetings or questions (e.g., 'hello', 'how are you').
- 'safe_query': Data retrieval queries (e.g., 'list all customers', 'find users named John').
- 'unsafe_query': Data modification or schema changes (e.g., 'add column', 'delete data').

### Instructions
- Return ONLY the label: 'casual', 'safe_query', or 'unsafe_query'.
- Consider the database schema to identify table or field references.
- Do not repeat the prompt or include any additional text.

### Database Schema
{schema_text}

### Examples
- 'List all customers' -> safe_query
- 'Show me all albums' -> safe_query
- 'Find users named John' -> safe_query
- 'Help me add a new column' -> unsafe_query
- 'Add an additional column pay' -> unsafe_query
- 'Hello, how are you?' -> casual
- 'Drop table users' -> unsafe_query
- 'How many customers are there?' -> safe_query
- 'Modify table structure' -> unsafe_query

### User Input
{user_input}

### Classification
"""
    try:
        inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
        with torch.no_grad():
            outputs = model.generate(**inputs, max_new_tokens=10)
        classification = tokenizer.decode(outputs[0], skip_special_tokens=True).strip()
        
        match = re.search(r"### Classification\s*(\w+)", classification, re.IGNORECASE)
        if match:
            label = match.group(1).lower()
            if label in ['casual', 'safe_query', 'unsafe_query']:
                logger.info(f"Qwen classified query as: {label}")
                return label
        
        match = re.search(r"(casual|safe_query|unsafe_query)\s*$", classification, re.IGNORECASE)
        if match:
            label = match.group(1).lower()
            logger.info(f"Qwen classified query as (last occurrence): {label}")
            return label
        
        user_input_lower = user_input.lower()
        if connection_type == "sql":
            schema_terms = {table.lower() for table in schema_info}
            for cols in schema_info.values():
                schema_terms.update(col.lower() for col in cols)
        else:
            schema_terms = {field['name'].lower() for coll in schema_info for field in coll['fields']}
        if any(term in user_input_lower for term in schema_terms):
            logger.info("Fallback: Schema term detected, classifying as 'safe_query'")
            return "safe_query"
        
        fallback_unsafe_patterns = [
            r"\badd\b\s*(new\s*|additional\s*|an\s*)?column\b",
            r"\bcreate\b\s*(new\s*)?column\b",
            r"\bdelete\b", r"\bdrop\b", r"\balter\b", r"\binsert\b",
            r"\bupdate\b", r"\btruncate\b", r"\bmodify\b", r"\bremove\b",
            r"\brename\b"
        ]
        if any(re.search(p, user_input_lower) for p in fallback_unsafe_patterns):
            logger.info("Fallback regex detected unsafe operation")
            return "unsafe_query"
        logger.info("Qwen returned invalid classification, defaulting to 'unsafe_query'")
        return "unsafe_query"
    except Exception as e:
        logger.error(f"Error classifying query with Qwen: {str(e)}")
        user_input_lower = user_input.lower()
        if connection_type == "sql":
            schema_terms = {table.lower() for table in schema_info}
            for cols in schema_info.values():
                schema_terms.update(col.lower() for col in cols)
        else:
            schema_terms = {field['name'].lower() for coll in schema_info for field in coll['fields']}
        if any(term in user_input_lower for term in schema_terms):
            logger.info("Fallback: Schema term detected on error, classifying as 'safe_query'")
            return "safe_query"
        if any(re.search(p, user_input_lower) for p in fallback_unsafe_patterns):
            logger.info("Fallback regex detected unsafe operation on error")
            return "unsafe_query"
        logger.info("Qwen classification failed, defaulting to 'unsafe_query'")
        return "unsafe_query"

async def generate_sql_query(user_input: str, schema_info: Dict):
    logger.info("Generating SQL query...")
    tokenizer = app.state.tokenizer
    model = app.state.model
    schema_text = "\n".join(f"Table: {table}\nColumns: {', '.join(columns)}\n"
                           for table, columns in schema_info.items())
    prompt = f"""You are Qwen, a SQL expert. Generate a MySQL query for:
    
    ### Schema
    {schema_text}
    
    ### User Query
    {user_input}
    
    ### SQL Query:
    """
    logger.info("Tokenizing prompt...")
    inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
    logger.info("Generating response...")
    with torch.no_grad():
        outputs = model.generate(**inputs, max_new_tokens=256)
    sql_query = tokenizer.decode(outputs[0], skip_special_tokens=True)
    match = re.search(r"(SELECT\s+.*?;)", sql_query, re.IGNORECASE | re.DOTALL)
    final_query = sql_query.split("SQL Query:")[-1].strip() if match else sql_query.strip()
    if match:
        final_query = match.group(1).strip()
        logger.info(f"Final SQL query: {final_query}")
    else:
        logger.info("No SELECT statement found.")
    return final_query

async def generate_typesense_query(user_input: str, schema: List, collection_name: str):
    logger.info(f"Generating Typesense query for collection: {collection_name}")
    tokenizer = app.state.tokenizer
    model = app.state.model
    prompt = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id>
You are a Typesense query expert. Given this collection schema:

{json.dumps([coll for coll in schema if coll['name'] == collection_name], indent=2)}

Convert this question into a Typesense query:

Question: {user_input}

Requirements:
1. Output must be valid JSON with these possible keys:
   - q (search term, use '*' for all documents)
   - filter_by (string with valid filters)
   - sort_by (field:asc or field:desc)
   - per_page (1-250)
   - query_by (fields to search)
2. For filters:
   - Use := for equality (e.g., name:='John', age:=17)
   - Use >, <, >=, <= for numbers (e.g., age:>30)
   - Combine with && or || (e.g., age:=17 && name:='John')
3. For counting queries (e.g., 'how many'):
   - Use filter_by to match exact conditions
   - Set per_page to 250
   - Do not include sort_by unless sorting is explicitly requested
4. For sorting queries (e.g., 'oldest', 'youngest'):
   - Use sort_by with asc or desc
   - Set per_page to 5 unless specified
5. Return ONLY the JSON object, no explanations.

Examples:
- Question: "how many users age 17"
  ```json
  {{
    "q": "*",
    "filter_by": "age:=17",
    "per_page": 250
  }}
  ```
- Question: "find users named John"
  ```json
  {{
    "q": "John",
    "query_by": "name",
    "per_page": 10
  }}
  ```
- Question: "oldest users"
  ```json
  {{
    "q": "*",
    "sort_by": "age:desc",
    "per_page": 5
  }}
  ```
- Question: "youngest users"
  ```json
  {{
    "q": "*",
    "sort_by": "age:asc",
    "per_page": 5
  }}
  ```

<|eot_id|><|start_header_id|>assistant<|end_header_id>
```json
"""
    try:
        inputs = tokenizer(prompt, return_tensors="pt", return_attention_mask=True).to("cuda")
        outputs = model.generate(
            **inputs,
            max_new_tokens=200,
            pad_token_id=tokenizer.eos_token_id,
            temperature=0.3,
            do_sample=True
        )
        response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        json_str = response.split("```json")[1].split("```")[0].strip()
        query = json.loads(json_str)
        validated_query = validate_typesense_query(query, user_input)
        logger.info(f"Validated Typesense query: {json.dumps(validated_query, indent=2)}")
        return validated_query
    except Exception as e:
        logger.error(f"Error generating Typesense query: {str(e)}")
        return None

def casual_response() -> str:
    responses = [
        "Just here helping with queries! Need anything else?",
        "I'm always ready to assist! What can I do for you?",
        "Hey there! How can I help today?",
    ]
    return random.choice(responses)

# Main query processing endpoint
@app.post("/safe-query", response_model=QueryResponse)
async def process_query(request: QueryRequest):
    logger.info(f"Received query request: {request.question}, connection_type: {request.connection_type}")
    try:
        if not hasattr(app.state, 'db_pool') or app.state.db_pool is None:
            logger.info("Warning: Database pool not available. Creating it now.")
            app.state.db_pool = await create_db_pool()
        
        if is_raw_sql_input(request.question) and request.connection_type == "sql":
            logger.info("Raw SQL input detected and blocked.")
            return QueryResponse(
                sql_response=SQLResponse(
                    sql_query="",
                    result=[],
                    visualization=None,
                    message="❌ Please use natural language to ask your question. Direct SQL input is not allowed.",
                    error=True
                )
            )
        
        if detect_unsafe_prompt(request.question, app.state.safety_model, app.state.safety_tokenizer):
            logger.info("Unsafe prompt detected by BERT model")
            response = QueryResponse()
            if request.connection_type == "sql":
                response.sql_response = SQLResponse(
                    sql_query="",
                    result=[],
                    visualization=None,
                    message="❌ Sorry, this request appears unsafe (potential prompt injection). Please try a different query.",
                    error=True
                )
            else:
                response.typesense_response = TypesenseResponse(
                    typesense_query=None,
                    result={},
                    message="❌ Sorry, this request appears unsafe (potential prompt injection). Please try a different query.",
                    error=True
                )
            return response
        
        schema_info = await get_mysql_schema() if request.connection_type == "sql" else app.state.typesense_schema
        classification = await classify_query_with_qwen(
            request.question, app.state.tokenizer, app.state.model, schema_info, request.connection_type
        )
        
        response = QueryResponse()
        
        if classification == "casual":
            logger.info("Query classified as casual conversation")
            if request.connection_type == "sql":
                response.sql_response = SQLResponse(
                    sql_query="",
                    result=[],
                    visualization=None,
                    message=casual_response(),
                    error=False
                )
            else:
                response.typesense_response = TypesenseResponse(
                    typesense_query=None,
                    result={},
                    message=casual_response(),
                    error=False
                )
            return response
        
        if classification == "unsafe_query":
            logger.info("Unsafe query operation detected by Qwen")
            if request.connection_type == "sql":
                response.sql_response = SQLResponse(
                    sql_query="",
                    result=[],
                    visualization=None,
                    message="❌ Sorry, operations like adding, modifying, or deleting data are not allowed. Try a read-only query instead (e.g., 'List all customers').",
                    error=True
                )
            else:
                response.typesense_response = TypesenseResponse(
                    typesense_query=None,
                    result={},
                    message="❌ Sorry, operations like adding, modifying, or deleting data are not allowed. Try a read-only query instead (e.g., 'Find users named John').",
                    error=True
                )
            return response
        
        if request.connection_type == "sql":
            sql_query = await generate_sql_query(request.question, schema_info)
            if not is_valid_sql(sql_query):
                logger.info("Generated SQL query is invalid or unsafe")
                response.sql_response = SQLResponse(
                    sql_query=sql_query,
                    result=[],
                    visualization=None,
                    message="❌ Sorry, the generated query is invalid or unsafe. Please try a different query.",
                    error=True
                )
                return response

            result, is_error = await execute_query(sql_query)
            if is_error:
                logger.info("Error during SQL query execution")
                response.sql_response = SQLResponse(
                    sql_query=sql_query,
                    result=[],
                    visualization=None,
                    message="❌ Sorry, there was an error executing the query. Please try again.",
                    error=True
                )
                return response
            
            # Generate visualization for SQL results
            visualization = visualize_sql_result(result, sql_query) if result else None
            
            response.sql_response = SQLResponse(
                sql_query=sql_query,
                result=result,
                visualization=visualization,
                message="Query executed successfully",
                error=False
            )
            return response
        else:
            collection_name = select_typesense_collection(request.db_connection)
            if not collection_name:
                response.typesense_response = TypesenseResponse(
                    typesense_query=None,
                    result={},
                    message="❌ Invalid or no Typesense collection found.",
                    error=True
                )
                return response
            
            typesense_query = await generate_typesense_query(request.question, schema_info, collection_name)
            if not typesense_query:
                response.typesense_response = TypesenseResponse(
                    typesense_query=None,
                    result={},
                    message="❌ Failed to generate a valid Typesense query.",
                    error=True
                )
                return response
            
            result, is_error = perform_typesense_search(collection_name, typesense_query)
            if is_error:
                logger.info("Error during Typesense query execution")
                response.typesense_response = TypesenseResponse(
                    typesense_query=typesense_query,
                    result={},
                    message=f"❌ Sorry, there was an error executing the query: {result['error']}",
                    error=True
                )
                return response
            
            response.typesense_response = TypesenseResponse(
                typesense_query=typesense_query,
                result=result,
                message="Typesense query executed successfully",
                error=False
            )
            return response
        
    except Exception as e:
        logger.error(f"Error in process_query: {e}")
        logger.error(traceback.format_exc())
        response = QueryResponse()
        if request.connection_type == "sql":
            response.sql_response = SQLResponse(
                sql_query="",
                result=[],
                visualization=None,
                message=f"Error: {str(e)}",
                error=True
            )
        else:
            response.typesense_response = TypesenseResponse(
                typesense_query=None,
                result={},
                message=f"Error: {str(e)}",
                error=True
            )
        return response

# Root endpoint
@app.get("/")
async def read_root():
    return {"message": "Welcome to the FastAPI API!"}