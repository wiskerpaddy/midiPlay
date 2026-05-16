let currentMidi = null;

// --- 1. 音源の定義 ---
// 共通の空間リバーブ
const reverb = new Tone.Reverb(1.5).toDestination();

// ① 生ピアノサンプラー
const piano = new Tone.Sampler({
    urls: { 
        "A1": "A1.mp3", 
        "A2": "A2.mp3", 
        "A3": "A3.mp3", 
        "A4": "A4.mp3" 
    },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    onload: () => console.log("生ピアノ音源の読み込みが完了しました")
}).connect(reverb);

// ② 従来のシンセサイザー（PolySynth）
const polySynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.8 }
}).connect(reverb);


// HTML要素の取得
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const playBtn = document.getElementById('play-btn');
const instrumentSelect = document.getElementById('instrument-select'); // ★追加

// 1. ファイル選択時の処理（変更なし）
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = file.name;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const arrayBuffer = event.target.result;
        
        try {
            if (typeof Midi !== 'undefined' && Midi.fromArrayBuffer) {
                currentMidi = Midi.fromArrayBuffer(arrayBuffer);
            } else if (typeof MidiConvert !== 'undefined') {
                currentMidi = MidiConvert.parse(arrayBuffer);
            } else {
                currentMidi = new Midi(arrayBuffer);
            }
            
            playBtn.disabled = false;
            console.log("MIDIデータのパースに成功しました:", currentMidi);

        } catch (error) {
            console.error("MIDIプレイヤー側での解析エラー:", error);
            alert(error);
        }
    };
    reader.readAsArrayBuffer(file);
});

// 2. 再生ボタンが押されたときの処理
playBtn.addEventListener('click', async () => {
    await Tone.start();
    if (!currentMidi) return;

    const now = Tone.now();
    
    // 現在選択されている音源のタイプ（"piano" または "synth"）を取得
    const selectedType = instrumentSelect.value;
    
    // 一度すべての音の残響を止める安全策
    piano.releaseAll();
    polySynth.releaseAll();

    // MIDIファイル内のすべてのトラックをループ処理
    currentMidi.tracks.forEach(track => {
        track.notes.forEach(note => {
            
            // ★選択肢によって鳴らす音源を条件分岐
            if (selectedType === 'piano') {
                piano.triggerAttackRelease(
                    note.name, 
                    note.duration, 
                    now + note.time, 
                    note.velocity
                );
            } else {
                // シンセサイザーで再生
                polySynth.triggerAttackRelease(
                    note.name, 
                    note.duration, 
                    now + note.time, 
                    note.velocity
                );
            }
            
        });
    });
});