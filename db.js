// db.js
const mysql = require('mysql2');
const dotenv = require('dotenv');

dotenv.config();

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to database');

    const sql = `CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`;
    connection.query(sql, (err) => {
        if (err) throw err;
        console.log('Database created');

        connection.query(`USE ${process.env.DB_NAME}`, (err) => {
            if (err) throw err;

            const createTableSql = `
                CREATE TABLE IF NOT EXISTS books (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    price DECIMAL(10, 2),
                    image_url VARCHAR(255)
                )
            `;
            connection.query(createTableSql, (err) => {
                if (err) throw err;
                console.log('Table created');
                connection.end();
            });
        });
    });
});
