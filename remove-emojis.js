const fs = require('fs');
const path = require('path');

function removeEmojis(text) {
  return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '');
}

function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const newContent = removeEmojis(content);
    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log('Processed:', filePath);
      return 1;
    }
  } catch (err) {
    console.error('Error:', filePath, err.message);
  }
  return 0;
}

function walkDir(dir, excludes = ['test-ui', 'node_modules', '.git']) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludes.includes(entry.name)) {
        count += walkDir(fullPath, excludes);
      }
    } else {
      if (entry.name.match(/\.(ts|js|md)$/)) {
        count += processFile(fullPath);
      }
    }
  }
  return count;
}

const total = walkDir('.');
console.log('\nTotal files processed:', total);
