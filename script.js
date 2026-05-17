// プレイヤー用の状態管理
let currentMidi = null;
let updateTimerId = null; 

// --- 音源とエフェクトの定義 ---
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

// ② シンセサイザー
const polySynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.8 }
}).connect(reverb);

// UI要素の取得
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const progressBar = document.getElementById('progress-bar');
const volumeSlider = document.getElementById('volume-slider');
const currentTimeDisplay = document.getElementById('current-time');
const totalTimeDisplay = document.getElementById('total-time');

// 音量変更
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        Tone.Destination.volume.value = parseFloat(e.target.value);
    });
}

// 時間フォーマット変換 (秒 -> m:ss)
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${String(sec).padStart(2, '0')}`;
}

// 1. MIDIファイル選択時の処理
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (fileNameDisplay) fileNameDisplay.textContent = file.name;

        // 状態を完全リセット
        resetPlayback();

        const reader = new FileReader();
        reader.onload = async (event) => {
            const arrayBuffer = event.target.result;
            
            try {
                if (typeof Midi !== 'undefined' && Midi.fromArrayBuffer) {
                    currentMidi = Midi.fromArrayBuffer(arrayBuffer);
                } else {
                    currentMidi = new Midi(arrayBuffer);
                }
                
                console.log("MIDIパース成功:", currentMidi);

                const duration = currentMidi.duration || 0;
                if (totalTimeDisplay) totalTimeDisplay.textContent = formatTime(duration);
                if (progressBar) {
                    progressBar.max = duration;
                    progressBar.value = 0;
                }

                // 元々100%綺麗に出る設定で楽譜を描画
                renderScoreFromMidi(currentMidi);

                // 再生タイムラインの構築
                setupMidiTransport();

                if (playBtn) playBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = false;
                if (pauseBtn) pauseBtn.disabled = true;

            } catch (error) {
                console.error("解析エラー:", error);
                alert("MIDIファイルの解析に失敗しました。");
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// 動的ABC生成＆レンダリング（もともと綺麗に出ていたオプション設定）
function renderScoreFromMidi(midi) {
    if (typeof ABCJS === 'undefined') {
        console.error("ABCJSが読み込まれていません");
        return;
    }

    let meter = "4/4";
    if (midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
        const ts = midi.header.timeSignatures[0];
        meter = `${ts.numerator}/${ts.denominator}`;
    }

    let bpm = 120;
    if (midi.header.tempos && midi.header.tempos.length > 0) {
        bpm = Math.round(midi.header.tempos[0].bpm);
    }

    let key = "C";
    if (midi.header.keySignatures && midi.header.keySignatures.length > 0) {
        key = midi.header.keySignatures[0].key;
    }

    let noteText = "";
    if (midi.tracks && midi.tracks.length > 0) {
        const track = midi.tracks[0];
        
        const midiToAbc = (midiNum) => {
            const notes = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
            const octave = Math.floor(midiNum / 12) - 1;
            const noteName = notes[midiNum % 12];
            
            if (octave === 4) return noteName; 
            if (octave === 5) return noteName.toLowerCase(); 
            if (octave < 4) return noteName + ",".repeat(4 - octave); 
            return noteName.toLowerCase() + "'".repeat(octave - 5); 
        };

        const sortedNotes = [...track.notes].sort((a, b) => a.time - b.time);
        let barCounter = 0;
        sortedNotes.forEach(note => {
            noteText += midiToAbc(note.midi) + " ";
            barCounter++;
            if (barCounter % 4 === 0) noteText += "| ";
        });
    }

    if (!noteText) noteText = "Z8";

    const dynamicAbc = `X:1\nT:${midi.header.name || "Imported MIDI"}\nM:${meter}\nQ:1/4=${bpm}\nK:${key}\nL:1/8\n| ${noteText}`;

    // もともと楽譜が正常に描画されていたシンプルなレンダリングに戻す
    ABCJS.renderAbc("paper", dynamicAbc, { responsive: "resize" });
}

// 再生クリーンアップ
function resetPlayback() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (updateTimerId !== null) {
        Tone.Transport.clear(updateTimerId);
        updateTimerId = null;
    }
    if (progressBar) progressBar.value = 0;
    if (currentTimeDisplay) currentTimeDisplay.textContent = "0:00";
    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;

    clearHighLight();
}

// すべてのハイライト（赤色）をリセットする安全な関数
function clearHighLight() {
    document.querySelectorAll("#paper svg path, #paper svg ellipse").forEach(el => {
        el.classList.remove("abcjs-highlight");
    });
}

// Tone.js タイムライン構築
function setupMidiTransport() {
    if (!currentMidi) return;

    const instrumentSelect = document.getElementById('instrument-select');
    const midiEvents = [];

    currentMidi.tracks.forEach(track => {
        track.notes.forEach(note => {
            midiEvents.push({
                time: note.time,
                name: note.name,
                duration: note.duration,
                velocity: note.velocity
            });
        });
    });

    new Tone.Part((time, event) => {
        const selectedType = instrumentSelect ? instrumentSelect.value : 'piano';
        if (selectedType === 'piano') {
            piano.triggerAttackRelease(event.name, event.duration, time, event.velocity);
        } else {
            polySynth.triggerAttackRelease(event.name, event.duration, time, event.velocity);
        }
    }, midiEvents).start(0);

    // ★【路線A】100ms周期のタイマーから、直接DOMの音符要素を数えてハイライト制御する
    updateTimerId = Tone.Transport.scheduleRepeat(() => {
        const currentSeconds = Tone.Transport.seconds;
        if (progressBar) progressBar.value = currentSeconds;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(currentSeconds);
        
        if (currentMidi && currentMidi.duration > 0) {
            // 進行度を 0.0 ～ 1.0 で算出
            const progress = currentSeconds / currentMidi.duration;
            
            // 描画された楽譜SVGの中から、音符の構成要素（pathやellipse）をすべて取得
            const noteElements = document.querySelectorAll("#paper svg path, #paper svg ellipse");
            if (noteElements.length > 0) {
                // 現在の進行度に対応する音符のインデックスを決定
                const targetIndex = Math.floor(progress * noteElements.length);
                
                // 一旦すべてクリアしてから、現在のターゲット音符に赤色クラスを付与
                clearHighLight();
                if (noteElements[targetIndex]) {
                    noteElements[targetIndex].classList.add("abcjs-highlight");
                }
            }
        }

        if (currentSeconds >= currentMidi.duration) {
            handleStop();
        }
    }, 0.1);
}

// 2. 再生ボタン
if (playBtn) {
    playBtn.addEventListener('click', async () => {
        await Tone.start();
        Tone.Transport.start();
        playBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = false;
    });
}

// 3. 一時停止ボタン
if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
        Tone.Transport.pause();
        if (playBtn) playBtn.disabled = false;
        pauseBtn.disabled = true;
    });
}

// 4. 停止ボタン
if (stopBtn) {
    stopBtn.addEventListener('click', () => {
        handleStop();
    });
}

function handleStop() {
    Tone.Transport.stop();
    clearHighLight();

    if (progressBar) progressBar.value = 0;
    if (currentTimeDisplay) currentTimeDisplay.textContent = "0:00";
    if (playBtn) playBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
}

// シークバー操作
if (progressBar) {
    progressBar.addEventListener('input', (e) => {
        if (!currentMidi) return;
        const seekTo = parseFloat(e.target.value);
        Tone.Transport.seconds = seekTo;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(seekTo);
    });
}