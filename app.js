// server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const fs = require('fs');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure MySQL
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

// Setup multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Ensure this directory exists
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    },
});
const upload = multer({ storage });

// Initialize S3 client
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
    },
});

// Create books table if it doesn't exist
const createTable = async () => {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS books (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT NOT NULL,
            price DECIMAL(10, 2) NOT NULL,
            image_url VARCHAR(255) NOT NULL
        )
    `);
    await connection.end();
};

// Route to add a book
app.post('/books', upload.single('image'), async (req, res) => {
    const { name, description, price } = req.body;
    const imageFile = req.file;

    if (!imageFile) {
        return res.status(400).json({ error: 'Image file is required' });
    }

    const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `images/${Date.now()}-${imageFile.originalname}`, // Create unique file key
        Body: fs.createReadStream(imageFile.path),
        ContentType: imageFile.mimetype,
    };

    // const efsDirectory = '/mnt/efs/images';
    // const efsFilePath = `${efsDirectory}/${Date.now()}-${imageFile.originalname}`; // Unique file path for EFS



    try {
        await s3.send(new PutObjectCommand(params));
        const imageUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/images/${Date.now()}-${imageFile.originalname}`;

        // Save file to EFS (copy the uploaded file to EFS)
        // if (!fs.existsSync(efsDirectory)) {
        //     fs.mkdirSync(efsDirectory, { recursive: true }); // Ensure the EFS directory exists
        // }
        // fs.copyFileSync(imageFile.path, efsFilePath); // Copy the file to EFS


        const connection = await mysql.createConnection(dbConfig);
        const [result] = await connection.execute('INSERT INTO books (name, description, price, image_url) VALUES (?, ?, ?, ?)', [name, description, price, imageUrl]);
        await connection.end();

        // Clean up local uploaded file
        fs.unlinkSync(imageFile.path); // Delete the file from local storage after upload

        res.status(201).json({ message: 'Book created', bookId: result.insertId });
    } catch (error) {
        console.error('Error adding book:', error);
        res.status(500).json({ error: 'Failed to upload image to S3 or insert into database' });
    }
});

// Route to get a specific book by ID
app.get('/books/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [books] = await connection.execute('SELECT * FROM books WHERE id = ?', [id]);
        await connection.end();

        if (books.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        res.json(books[0]);
    } catch (error) {
        console.error('Error fetching book:', error);
        res.status(500).json({ error: 'Failed to fetch book' });
    }
});

// Route to get all books
app.get('/books', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [books] = await connection.execute('SELECT * FROM books');
        await connection.end();
        res.json(books);
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).json({ error: 'Failed to fetch books' });
    }
});

// Route to delete a book
app.delete('/books/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        
        // Fetch the book to get the image URL before deletion
        const [books] = await connection.execute('SELECT * FROM books WHERE id = ?', [id]);
        
        if (books.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        const book = books[0];
        
        // Delete the book from the database
        await connection.execute('DELETE FROM books WHERE id = ?', [id]);
        await connection.end();

        // Delete the image from S3
        const imageKey = book.image_url.split('/').pop(); // Get the image key from the URL

        // Use DeleteObjectCommand to delete the object from S3
        await s3.send(new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `images/${imageKey}`
        }));

        // const efsFilePath = `/mnt/efs/images/${imageKey}`; // Unique file path for EFS
        // if (fs.existsSync(efsFilePath)) {
        //     fs.unlinkSync(efsFilePath); // Delete the file from EFS
        // }

        res.json({ message: 'Book deleted successfully' });
    } catch (error) {
        console.error('Error deleting book:', error);
        res.status(500).json({ error: 'Failed to delete book' });
    }
});

// Start the server
app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    await createTable(); // Create the table on server start
});
