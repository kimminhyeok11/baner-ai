const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

let depth = 0;
let inString = false;
let stringChar = '';
let inTemplate = false;
let inComment = false;
let inBlockComment = false;
let lineNum = 1;

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i+1];
    if (char === '\n') lineNum++;

    if (inComment) {
        if (char === '\n') inComment = false;
        continue;
    }
    if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
            inBlockComment = false;
            i++;
        }
        continue;
    }
    if (inTemplate) {
        if (char === '`' && content[i-1] !== '\\') {
            inTemplate = false;
        } else if (char === '$' && content[i+1] === '{') {
            depth++;
            i++;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
        }
        continue;
    }
    if (inString) {
        if (char === stringChar && content[i-1] !== '\\') {
            inString = false;
        }
        continue;
    }

    if (char === '/' && nextChar === '/') {
        inComment = true;
        i++;
    } else if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
    } else if (char === '`') {
        inTemplate = true;
    } else if (char === "'" || char === '"') {
        inString = true;
        stringChar = char;
    } else if (char === '{') {
        depth++;
    } else if (char === '}') {
        depth--;
        if (depth < 0) {
            console.log('NEGATIVE DEPTH AT LINE:', lineNum);
            depth = 0;
        }
    }
}
console.log('Final depth:', depth);
