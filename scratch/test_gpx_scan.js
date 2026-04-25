const fs = require('fs');
const readline = require('readline');

async function scanGpx(filePath) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const tracks = [];
    let currentTrackName = null;
    let lineCount = 0;

    for await (const line of rl) {
        lineCount++;
        const nameMatch = line.match(/<name>(.*?)<\/name>/);
        if (nameMatch && line.includes('<trk>')) {
             tracks.push(nameMatch[1]);
        } else if (nameMatch && currentTrackName === null) {
            // Might be track name on a separate line
            // But usually <trk><name>... are close
        }
        
        if (lineCount % 100000 === 0) {
            console.log(`Processed ${lineCount} lines...`);
        }
    }
    console.log(`Found ${tracks.length} tracks.`);
    console.log(`Total lines: ${lineCount}`);
    return tracks;
}

scanGpx('data/noisy_data.gpx').catch(console.error);
