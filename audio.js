// The Depths of Tartarus - Audio Engine (Procedural Synthesis)

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.ambienceNode = null;
        this.musicInterval = null;
        this.isPlayingBossTheme = false;
        this.isMuted = false;
    }

    /**
     * Initializes the Audio Context on user interaction (Play Game)
     */
    init() {
        if (this.ctx) return;
        
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.startAmbience();
        } catch (e) {
            console.warn("Web Audio API is not supported in this browser:", e);
        }
    }

    /**
     * Synthesizes a Low Gothic Underworld Drone
     */
    startAmbience() {
        if (!this.ctx || this.isMuted) return;

        // Create oscillator 1 (Low Sawtooth)
        const osc1 = this.ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = 55; // A1 note
        osc1.detune.value = -10;

        // Create oscillator 2 (Sub-bass triangle)
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = 55.44; // C#2 note
        osc2.detune.value = 10;

        // Lowpass filter to muffle the sounds and make it creepy
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 120; // filter out mid/high frequencies

        // Delay effect for depth
        const delay = this.ctx.createDelay(1.0);
        delay.delayTime.value = 0.6;
        const delayGain = this.ctx.createGain();
        delayGain.gain.value = 0.35; // feedback volume

        // Feedback loop
        delay.connect(delayGain);
        delayGain.connect(delay);

        // Volume control
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 0.25;

        // Connections
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gainNode);
        
        // Connect to delay line
        filter.connect(delay);
        delayGain.connect(gainNode);
        
        gainNode.connect(this.ctx.destination);

        osc1.start();
        osc2.start();

        this.ambienceNode = { osc1, osc2, gainNode };
    }

    /**
     * Stop Underworld Ambience
     */
    stopAmbience() {
        if (this.ambienceNode) {
            try {
                this.ambienceNode.osc1.stop();
                this.ambienceNode.osc2.stop();
                this.ambienceNode.gainNode.disconnect();
            } catch (e) {}
            this.ambienceNode = null;
        }
    }

    /**
     * Generates a noise buffer for atmospheric wind or explosions
     */
    getNoiseBuffer() {
        const bufferSize = this.ctx.sampleRate * 2.0; // 2 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2.0 - 1.0;
        }
        return buffer;
    }

    /**
     * SFX: Spell Cast Whoosh
     */
    playCast() {
        if (!this.ctx || this.isMuted) return;

        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = this.getNoiseBuffer();

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1500, this.ctx.currentTime);
        // Sweep frequency downwards
        filter.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.45);
        filter.Q.value = 4.0;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

        noiseNode.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        noiseNode.start();
        noiseNode.stop(this.ctx.currentTime + 0.5);
    }

    /**
     * SFX: Valid spell impact (BOOM)
     */
    playSuccess(damage) {
        if (!this.ctx || this.isMuted) return;

        // Sub-bass sweep
        const subOsc = this.ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(150, this.ctx.currentTime);
        subOsc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.6);

        const subGain = this.ctx.createGain();
        // Base success sound volume scales slightly with damage
        const vol = Math.min(0.8, 0.3 + (damage / 150));
        subGain.gain.setValueAtTime(vol, this.ctx.currentTime);
        subGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.75);

        subOsc.connect(subGain);
        subGain.connect(this.ctx.destination);
        subOsc.start();
        subOsc.stop(this.ctx.currentTime + 0.8);

        // Flame burst sizzle (filtered noise)
        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = this.getNoiseBuffer();

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 600;

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(vol * 0.4, this.ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);

        noiseNode.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        noiseNode.start();
        noiseNode.stop(this.ctx.currentTime + 0.5);
    }

    /**
     * SFX: Invalid spell fizzle (Dissonant Holy Burn)
     */
    playFailure() {
        if (!this.ctx || this.isMuted) return;

        // Dissonant square wave nodes
        const osc1 = this.ctx.createOscillator();
        osc1.type = 'square';
        osc1.frequency.value = 130;

        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = 133;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(1000, this.ctx.currentTime);
        lowpass.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.45);

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gainNode.gain.setValueAtTime(0.3, this.ctx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

        osc1.connect(lowpass);
        osc2.connect(lowpass);
        lowpass.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(this.ctx.currentTime + 0.5);
        osc2.stop(this.ctx.currentTime + 0.5);
    }

    /**
     * SFX: Holy Barrier Shivering / Shattering
     */
    playShatter() {
        if (!this.ctx || this.isMuted) return;

        // High frequency glass chime
        for (let i = 0; i < 4; i++) {
            const chime = this.ctx.createOscillator();
            chime.type = 'sine';
            chime.frequency.setValueAtTime(800 + (i * 350), this.ctx.currentTime);
            chime.frequency.linearRampToValueAtTime(1500 - (i * 100), this.ctx.currentTime + 0.8);

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.005, this.ctx.currentTime + 0.8);

            chime.connect(gain);
            gain.connect(this.ctx.destination);
            chime.start();
            chime.stop(this.ctx.currentTime + 0.8);
        }

        // Noise blast for impact explosion
        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = this.getNoiseBuffer();

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1200;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.6, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.9);

        noiseNode.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        noiseNode.start();
        noiseNode.stop(this.ctx.currentTime + 1.0);
    }

    /**
     * Starts the Angelic Boss combat music (Procedural rhythmic synth)
     */
    startBossTheme() {
        if (!this.ctx || this.isMuted || this.isPlayingBossTheme) return;

        this.stopAmbience();
        this.isPlayingBossTheme = true;
        
        let step = 0;
        // Simple 8-step ominous arpeggiator in D Minor
        // Chord progression: Dm, Bb, Gm, A
        const notes = [
            [73.42, 110.00, 146.83], // Dm (D2, A2, D3)
            [58.27, 116.54, 139.00], // Bb (Bb1, Bb2, F3)
            [98.00, 146.83, 196.00], // Gm (G2, D3, G3)
            [110.00, 164.81, 220.00] // A (A2, E3, A3)
        ];

        this.musicInterval = setInterval(() => {
            if (!this.ctx) return;
            
            const chordIdx = Math.floor(step / 8) % notes.length;
            const noteIdx = step % 3;
            const freq = notes[chordIdx][noteIdx] * (step % 2 === 0 ? 1 : 1.5);

            // Synth lead
            const leadOsc = this.ctx.createOscillator();
            leadOsc.type = 'triangle';
            leadOsc.frequency.value = freq;

            const leadFilter = this.ctx.createBiquadFilter();
            leadFilter.type = 'lowpass';
            leadFilter.frequency.value = 400 + Math.sin(step) * 200;

            const leadGain = this.ctx.createGain();
            leadGain.gain.setValueAtTime(0.14, this.ctx.currentTime);
            leadGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.22);

            leadOsc.connect(leadFilter);
            leadFilter.connect(leadGain);
            leadGain.connect(this.ctx.destination);

            leadOsc.start();
            leadOsc.stop(this.ctx.currentTime + 0.25);

            // Add simple industrial drum beat every 4 steps
            if (step % 4 === 0) {
                // Bass Drum
                const kick = this.ctx.createOscillator();
                kick.type = 'sine';
                kick.frequency.setValueAtTime(120, this.ctx.currentTime);
                kick.frequency.exponentialRampToValueAtTime(45, this.ctx.currentTime + 0.2);

                const kickGain = this.ctx.createGain();
                kickGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
                kickGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

                kick.connect(kickGain);
                kickGain.connect(this.ctx.destination);
                kick.start();
                kick.stop(this.ctx.currentTime + 0.25);
            }

            step++;
        }, 140); // 140ms per step (fast, driving rhythm)
    }

    /**
     * Stops the Angelic Boss combat music
     */
    stopBossTheme() {
        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }
        this.isPlayingBossTheme = false;
        this.startAmbience();
    }
}

// Global Single Instance
const audio = new AudioEngine();
