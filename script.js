let currentMidi = null;

// シンセサイザー（音源）の準備
const synth = new Tone.PolySynth(Tone.Synth).toDestination();

// HTML要素の取得
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const playBtn = document.getElementById('play-btn');

// 1. ファイルが選択されたときの処理
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 画面にファイル名を表示
    fileNameDisplay.textContent = file.name;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const arrayBuffer = event.target.result;
        
        try {
            // ★【修正ポイント】CDN読み込み時に最も安全なパース方法に変更します
            if (typeof Midi !== 'undefined' && Midi.fromArrayBuffer) {
                currentMidi = Midi.fromArrayBuffer(arrayBuffer);
            } else if (typeof MidiConvert !== 'undefined') {
                currentMidi = MidiConvert.parse(arrayBuffer);
            } else {
                // 万が一どちらのクラス名でもない場合のフォールバック
                currentMidi = new Midi(arrayBuffer);
            }
            
            // パースが成功したら、確実に再生ボタンを活性化
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
    // ブラウザの音響機能を有効化（ユーザー操作の直後である必要があるためここで実行）
    await Tone.start();
    
    if (!currentMidi) return;

    const now = Tone.now();
    
    // MIDIファイル内のすべてのトラックをループ処理
    currentMidi.tracks.forEach(track => {
        // トラック内のノート（音符）をループ処理
        track.notes.forEach(note => {
            // 指定されたタイミング、音程、長さで音を鳴らすスケジュールを登録
            synth.triggerAttackRelease(
                note.name, 
                note.duration, 
                note.time + now, 
                note.velocity
            );
        });
    });
});