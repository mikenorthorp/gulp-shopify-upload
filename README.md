Example Usage

API KEY and PASSWORD are created by making a private app in Shopify

// Gulp plugin setup
var gulp = require('gulp');
// Watches single files
var watch = require('gulp-watch');
var gulpShopify = require('gulp-shopify-upload');

gulp.task('shopifywatch', function() {
	watch('./+(assets|layout|config|snippets|templates|locales)/**')
	.pipe(gulpShopify('API KEY', 'PASSWORD', 'MYSITE.myshopify.com', 'BASE NAME', 'optional{THEME ID}'));
});

// Default gulp action when gulp is run
gulp.task('default', [
        'shopifywatch'
]);