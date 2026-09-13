const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    publishingYear: { type: Number, required: true },
    coverImage: { type: String },
}, { timestamps: true });

bookSchema.set('toJSON', { virtuals: true });
bookSchema.set('toObject', { virtuals: true });

bookSchema.virtual('coverImageUrl').get(function () {
    return this.coverImage;
});

module.exports = mongoose.model('Book', bookSchema);