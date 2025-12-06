document.addEventListener('DOMContentLoaded', async () => {
    const generateBtn = document.getElementById('generateBtn');
    const chordInput = document.getElementById('chordInput');
    const downloadArea = document.getElementById('downloadArea');
    const downloadLink = document.getElementById('downloadLink');
    const statusMessage = document.getElementById('statusMessage');

    // Logging helper
    function log(msg) {
        console.log(msg);
        statusMessage.innerHTML += `<div>${msg}</div>`;
    }

    let pyodide = null;

    // Initialize OSMD
    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmdCanvas", {
        autoResize: true,
        backend: "svg",
        drawingParameters: "compacttight",
        drawTitle: false,
        drawMeasureNumbers: false, // Hide measure numbers (0, 1, 2...)
        darkMode: false
    });

    // 1. Initialize Pyodide
    async function initPyodide() {
        try {
            statusMessage.innerHTML = "";
            log("Loading Pyodide...");
            pyodide = await loadPyodide({
                stdout: (text) => log(`[Py]: ${text}`),
                stderr: (text) => log(`<span style="color:orange">[PyW]: ${text}</span>`)
            });

            log("Installing music21==9.1.0...");
            await pyodide.loadPackage("micropip");
            const micropip = pyodide.pyimport("micropip");
            await micropip.install("music21==9.1.0");

            log("Setting up Python processor...");
            // Fetch and write the python logic to Pyodide's filesystem
            try {
                const response = await fetch('chord_processor.py?t=' + Date.now());
                if (response.ok) {
                    const pyCode = await response.text();
                    // Write to current working directory (usually /home/pyodide)
                    pyodide.FS.writeFile("chord_processor.py", pyCode);
                    log("Loaded chord_processor.py from server.");
                } else {
                    throw new Error("Fetch failed");
                }
            } catch (e) {
                log("Using fallback Python code...");
                const fallbackCode = `
import music21
import os

def process_chord_progression(chord_text, output_path):
    print(f"Processing: {chord_text}")
    raw_chords = chord_text.replace('\\n', ' ').split()
    s = music21.stream.Score()
    p = music21.stream.Part()
    p.append(music21.meter.TimeSignature('4/4'))
    
    for token in raw_chords:
        try:
            if not token: continue
            h = music21.harmony.ChordSymbol(token)
            h.duration.type = 'whole'
            m = music21.stream.Measure()
            m.append(h)
            p.append(m)
        except Exception as e:
            print(f"Error parsing {token}: {e}")
            pass

    s.append(p)
    s.write('musicxml', fp=output_path)
    print(f"Wrote to {output_path}")
`;
                // Write to current working directory
                pyodide.FS.writeFile("chord_processor.py", fallbackCode);
            }

            // Debug: check if file exists and print sys.path
            pyodide.runPython(`
import sys
import os
print("CWD:", os.getcwd())
print("Files in CWD:", os.listdir())
print("sys.path:", sys.path)
`);

            log("Ready!");
            chordInput.disabled = false;
            generateBtn.disabled = false;
            generateBtn.textContent = "Generate Score";

        } catch (err) {
            console.error(err);
            log(`<span style="color:red">Init Error: ${err.message}</span>`);
        }
    }

    initPyodide();

    // Function to fetch and reload the Python processor code
    async function reloadProcessorCode() {
        log("Fetching latest chord_processor.py...");
        try {
            const response = await fetch('chord_processor.py?t=' + Date.now());
            if (response.ok) {
                const pyCode = await response.text();
                // Write to current working directory
                pyodide.FS.writeFile("chord_processor.py", pyCode);

                // Force reload of the module in Python
                // We need to import importlib and reload the module if it was already imported
                log("Reloading python module...");
                pyodide.runPython(`
import importlib
import chord_processor
importlib.reload(chord_processor)
from chord_processor import process_chord_progression
`);
            } else {
                throw new Error("Fetch failed: " + response.statusText);
            }
        } catch (e) {
            log(`Warn: Could not reload code (${e.message}), using existing version.`);
        }
    }

    const testDataBtn = document.getElementById('testDataBtn');

    // Musicca Reference Chord Data
    const testChords = `
C Cmaj7 Cm Cm7 C7 Cdim Caug Csus4
Db Dbmaj7 Dbm Dbm7 Db7
D Dmaj7 Dm Dm7 D7
Eb Ebmaj7 Ebm Ebm7 Eb7
E Emaj7 Em Em7 E7
F Fmaj7 Fm Fm7 F7
F# F#maj7 F#m F#m7 F#7
G Gmaj7 Gm Gm7 G7
Ab Abmaj7 Abm Abm7 Ab7
A Amaj7 Am Am7 A7
Bb Bbmaj7 Bbm Bbm7 Bb7
B Bmaj7 Bm Bm7 B7
`.trim().replace(/\n/g, ' ');

    if (testDataBtn) {
        testDataBtn.addEventListener('click', () => {
            chordInput.value = testChords;
        });
    }

    generateBtn.addEventListener('click', async () => {
        const chords = chordInput.value;
        if (!chords.trim()) return;

        statusMessage.innerHTML = ""; // Clear previous logs
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';
        log("Starting generation...");

        try {
            // Reload code to ensure latest changes are picked up
            await reloadProcessorCode();

            // Import the function (crucial: must run after reload, and even if reload failed)
            log("Importing python module...");
            pyodide.runPython(`from chord_processor import process_chord_progression`);

            // Execute function
            const outputPath = "/output.musicxml";
            const safeChords = chords.replace(/'/g, "\\'").replace(/\n/g, "\\n");

            log("Running process_chord_progression...");
            pyodide.runPython(`process_chord_progression('${safeChords}', '${outputPath}')`);

            // Read back the file
            log("Reading output file...");
            if (!pyodide.FS.analyzePath(outputPath).exists) {
                throw new Error("Output file was not created by Python script.");
            }
            const xmlContent = pyodide.FS.readFile(outputPath, { encoding: 'utf8' });

            // Load into OSMD
            log("Rendering score...");
            await osmd.load(xmlContent);
            osmd.render();

            // Setup download link
            const blob = new Blob([xmlContent], { type: 'application/vnd.recordare.musicxml+xml' });
            const url = URL.createObjectURL(blob);
            downloadLink.href = url;
            downloadArea.style.display = 'block';
            log("Success!");

        } catch (error) {
            console.error(error);
            log(`<span style="color:red">Error: ${error.message}</span>`);
            if (error.stack) {
                log(`<pre style="font-size:0.8rem; color:red; overflow:auto">${error.stack}</pre>`);
            }
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Score';
        }
    });
});
