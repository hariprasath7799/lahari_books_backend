const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const Book = require('../models/Books');
const Page = require('../models/Page');
const Highlight = require('../models/Highlight');
const { GoogleGenAI } = require('@google/genai');
// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer to keep the image in memory, not save to disk
const uploadMemory = multer({ storage: multer.memoryStorage() });

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// POST /api/books/scan-page
router.post('/scan-page', uploadMemory.single('pageImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Convert the image buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype; // e.g., 'image/jpeg'

    const prompt = `
You are an expert multilingual OCR system specializing in Indian language book digitizing (Tamil, Telugu, Hindi, Malayalam, Kannada, Bengali, Marathi, Gujarati, English, etc.).

Analyze this book page image and transcribe all text into clean, semantic HTML following these strict guidelines:

1. TEXT ACCURACY & INDIC SCRIPT NORMALIZATION:
   - Extract all native script text accurately with standard NFC Unicode encoding.
   - Join hyphenated or line-split words naturally across line breaks (e.g. convert "கொடுத்-\nதுவிட்டான்" to "கொடுத்துவிட்டான்").

2. PUNCTUATION & SENTENCE BOUNDARIES (CRITICAL FOR AUDIO READERS):
   - Preserve all original punctuation.
   - Ensure every paragraph (<p>) and heading (<h2>, <h3>) ends with clear sentence punctuation (e.g., '.', '!', '?', or '|'). 

3. SEMANTIC HTML STRUCTURE:
   - Wrap normal text paragraphs in simple <p>...</p> tags.
   - Wrap section/chapter titles in <h2> or <h3> tags.
   - Preserve text formatting using only <strong> for bold and <em> for italics.
   - Preserve text alignment using simple inline styles where relevant (e.g., <h3 style="text-align: center;"> or <p style="text-align: center;">).
   - Do NOT use unnecessary <span>, <div>, or complex style attributes.
   - Ensure a newline character (\n) exists between adjacent HTML block tags.

4. OUTPUT FORMAT:
   - Return ONLY the raw valid HTML content.
   - Do NOT include markdown code blocks like \`\`\`html or \`\`\`.
   - Do NOT include any introductory or concluding text.
`.trim();


    // Call the Gemini API
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        { text: prompt },
        { inlineData: { data: base64Image, mimeType: mimeType } }
      ]
    });

    const htmlContent = response.text;

    // Return the perfectly formatted HTML to the frontend!
    res.status(200).json({ content: htmlContent });

  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: 'Failed to scan image' });
  }
});
// Storage configuration for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'cover-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

// --- ADMIN ROUTES ---

// Create a new book (POST /api/books)
router.post('/', upload.single('coverImage'), async (req, res) => {
  try {
    const { title, author, publishingYear } = req.body;

    if (!title || !author || !publishingYear) {
      return res.status(400).json({ error: 'title, author, and publishingYear are required' });
    }

    const coverImage = req.file
      ? `/uploads/${req.file.filename}`
      : (req.body.coverImage || req.body.coverImageUrl || null);

    const newBook = new Book({
      title,
      author,
      publishingYear: Number(publishingYear),
      coverImage
    });

    await newBook.save();
    res.status(201).json(newBook);
  } catch (error) {
    console.error('Error creating book:', error);
    res.status(500).json({ error: 'Failed to create book' });
  }
});

// Global Search (GET /api/books/search?q=your+search+term)
router.get('/search', async (req, res) => {
  try {
    const searchQuery = req.query.q;

    if (!searchQuery) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // 1. Search the Pages collection using the text index
    const matchingPages = await Page.find(
      { $text: { $search: searchQuery } },
      { score: { $meta: 'textScore' } } // Optional: Get relevance score
    )
      .sort({ score: { $meta: 'textScore' } }) // Sort by most relevant match
      .populate('bookId', 'title author coverImage'); // Bring in the book details

    if (!matchingPages.length) {
      return res.status(200).json([]);
    }

    // 2. Group the results by Book
    // Right now, we have a list of pages. If a book has 5 pages that match, 
    // we want to group them together under one book object.
    const groupedResults = matchingPages.reduce((acc, page) => {
      const bookIdStr = page.bookId._id.toString();

      // If we haven't seen this book yet, create an entry for it
      if (!acc[bookIdStr]) {
        acc[bookIdStr] = {
          book: page.bookId, // The populated book details (title, cover, etc)
          matchingPages: []
        };
      }

      // Add the page number and a snippet of the text to the book's array
      acc[bookIdStr].matchingPages.push({
        pageNumber: page.pageNumber,
        // Extract a 100-character snippet around the matched word for context
        contentSnippet: extractSnippet(page.content, searchQuery)
      });

      return acc;
    }, {});

    // Convert the grouped object back into an array for the frontend
    res.status(200).json(Object.values(groupedResults));

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

// Helper function to extract a snippet around the matched word
function extractSnippet(fullText, searchTerm) {
  const index = fullText.toLowerCase().indexOf(searchTerm.toLowerCase());
  if (index === -1) return fullText.substring(0, 100) + '...';

  const start = Math.max(0, index - 40);
  const end = Math.min(fullText.length, index + searchTerm.length + 40);

  let snippet = fullText.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < fullText.length) snippet = snippet + '...';

  return snippet;
}

// Search within a specific book (GET /api/books/:bookId/search?q=your+search+term)
router.get('/:bookId/search', async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const searchQuery = req.query.q;

    if (!searchQuery) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const matchingPages = await Page.find(
      {
        bookId: bookId,
        $text: { $search: searchQuery }
      },
      { score: { $meta: 'textScore' } }
    ).sort({ score: { $meta: 'textScore' } });

    // Format the response
    const results = matchingPages.map(page => ({
      pageNumber: page.pageNumber,
      contentSnippet: extractSnippet(page.content, searchQuery)
    }));

    res.status(200).json({
      bookId: bookId,
      results: results
    });

  } catch (error) {
    console.error('Book specific search error:', error);
    res.status(500).json({ error: 'Failed to perform search in this book' });
  }
});
// Update an existing book (PUT /api/books/:id)
router.put('/:id', upload.single('coverImage'), async (req, res) => {
  try {
    const { title, author, publishingYear } = req.body;
    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (author !== undefined) updateData.author = author;
    if (publishingYear !== undefined) updateData.publishingYear = Number(publishingYear);

    // Update coverImage if a new file is uploaded or passed in body
    if (req.file) {
      updateData.coverImage = `/uploads/${req.file.filename}`;
    } else if (req.body.coverImage !== undefined) {
      updateData.coverImage = req.body.coverImage;
    } else if (req.body.coverImageUrl !== undefined) {
      updateData.coverImage = req.body.coverImageUrl;
    }

    const updatedBook = await Book.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!updatedBook) {
      return res.status(404).json({ error: 'Book not found' });
    }

    res.status(200).json(updatedBook);
  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ error: 'Failed to update book' });
  }
});

// Add a new page to a book
router.post('/:bookId/pages', async (req, res) => {
  try {
    const { pageNumber, content } = req.body;
    const newPage = new Page({
      bookId: req.params.bookId,
      pageNumber,
      content
    });
    await newPage.save();
    res.status(201).json(newPage);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add page' });
  }
});

// Edit existing page content
router.put('/pages/:pageId', async (req, res) => {
  try {
    const { content } = req.body;
    const updatedPage = await Page.findByIdAndUpdate(
      req.params.pageId,
      { content },
      { new: true }
    );
    res.status(200).json(updatedPage);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update page' });
  }
});

// --- READER ROUTES ---

// Get all books (GET /api/books)
router.get('/', async (req, res) => {
  try {
    // We use aggregation to join data from the Pages and Highlights collections
    const booksWithMetadata = await Book.aggregate([
      // Step 1: Join with Pages to count total pages
      {
        $lookup: {
          from: 'pages', // The collection name (Mongoose pluralizes 'Page')
          localField: '_id',
          foreignField: 'bookId',
          as: 'pagesData'
        }
      },
      // Step 2: Join with Highlights to get all highlights for this book
      {
        $lookup: {
          from: 'highlights', // The collection name
          localField: '_id',
          foreignField: 'bookId',
          as: 'highlightsData'
        }
      },
      // Step 3: We need to find exactly WHICH pages are highlighted. 
      // We look up the Page documents associated with the highlights to get the actual pageNumber.
      {
        $lookup: {
          from: 'pages',
          localField: 'highlightsData.pageId',
          foreignField: '_id',
          as: 'highlightedPageDocs'
        }
      },
      // Step 4: Shape the final output
      {
        $project: {
          title: 1,
          author: 1,
          publishingYear: 1,
          coverImage: 1,
          coverImageUrl: '$coverImage',
          createdAt: 1,
          updatedAt: 1,
          totalPages: { $size: '$pagesData' }, // Count the number of pages
          // Map through the populated page documents and extract just the unique pageNumbers
          highlightedPages: {
            $setUnion: [
              {
                $map: {
                  input: '$highlightedPageDocs',
                  as: 'pageDoc',
                  in: '$$pageDoc.pageNumber'
                }
              },
              [] // Ensure it returns a unique array, even if empty
            ]
          }
        }
      },
      // Step 5: Sort newest first
      { $sort: { createdAt: -1 } }
    ]);

    res.status(200).json(booksWithMetadata);
  } catch (error) {
    console.error('Error fetching books metadata:', error);
    res.status(500).json({ error: 'Failed to fetch books metadata' });
  }
});

// Get a single book by ID (GET /api/books/:id)
router.get('/:id', async (req, res) => {
  try {
    const bookId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ error: 'Invalid book ID format' });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const totalPages = await Page.countDocuments({ bookId: book._id });

    res.status(200).json({
      ...book.toObject(),
      totalPages
    });
  } catch (error) {
    console.error('Error fetching book by ID:', error);
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// Get a specific page for a book (Pagination via query: ?pageNumber=1)
router.get('/:bookId/pages', async (req, res) => {
  try {
    const pageNumber = parseInt(req.query.pageNumber) || 1;
    const bookId = req.params.bookId;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ error: 'Invalid book ID format' });
    }

    // Run three queries in parallel for maximum performance
    const [page, totalPages, highlights] = await Promise.all([
      Page.findOne({ bookId: bookId, pageNumber: pageNumber }),
      Page.countDocuments({ bookId: bookId }),
      Highlight.find({ bookId: bookId }).populate('pageId', 'pageNumber')
    ]);

    if (!page) return res.status(404).json({ error: 'Page not found' });

    const highlightedPages = [...new Set(
      highlights
        .filter(h => h.pageId)
        .map(h => h.pageId.pageNumber)
    )].sort((a, b) => a - b);

    res.status(200).json({
      _id: page._id,
      bookId: page.bookId,
      pageNumber: page.pageNumber,
      content: page.content,
      totalPages: totalPages,
      highlightedPages: highlightedPages
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

module.exports = router;