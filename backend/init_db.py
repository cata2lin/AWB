"""
Database initialization script.
Creates the AWBprint database if it doesn't exist.
"""
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# Connect to the postgres default database to create our database
conn = psycopg2.connect(
    host="localhost",
    port=5432,
    user="postgres", 
    password="123",
    database="postgres"
)
conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

cursor = conn.cursor()

# Check if database exists
cursor.execute("SELECT 1 FROM pg_database WHERE datname = 'awbprint'")
exists = cursor.fetchone()

if not exists:
    print("Creating database 'AWBprint'...")
    cursor.execute("CREATE DATABASE awbprint")
    print("Database created successfully!")
else:
    print("Database 'AWBprint' already exists.")

cursor.close()
conn.close()
