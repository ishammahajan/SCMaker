import { STEPS } from '../shared/music.js';

// Only validated numeric recipes, generated IDs, and escaped strings reach these builders.
export const scString = (value) => JSON.stringify(value);

export function bootstrap({ token, replyPort, audioPort }) {
  return `(
~reply = NetAddr("127.0.0.1", ${replyPort});
~secret = ${scString(token)};
s = Server(\\scmaker, NetAddr("127.0.0.1", ${audioPort}));
Server.default = s;
s.options.bindAddress = "127.0.0.1";
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.options.memSize = 65536;
s.options.maxNodes = 4096;
s.options.zeroConf = false;
s.latency = 0.08;
~tracks = [];
~live = IdentityDictionary.new;
~clock = TempoClock.new(1.8, 0, nil, 4096);
~routine = nil;
~captureActive = false;
~captureHeld = IdentityDictionary.new;
~finishCapturedNote = { |key|
    var note = ~captureHeld.removeAt(key);
    if(note.notNil, {
        var start = ((note[1] - ~captureStart) * 4).round.asInteger.clip(0, 31);
        var end = ((~clock.beats - ~captureStart) * 4).round.asInteger.clip(start + 1, 32);
        ~reply.sendMsg("/scmaker/captured", ~secret, ~captureId, note[0], start, end - start);
    });
};
~finishCapture = {
    ~captureHeld.keys.asArray.do({ |key| ~finishCapturedNote.(key); });
    ~captureActive = false;
    ~reply.sendMsg("/scmaker/captureFinished", ~secret, ~captureId);
};
OSCdef(\\scmakerCommand, { |msg, time, addr|
    if((addr.ip == "127.0.0.1") and: { msg[1].asString == ~secret }, {
        Routine({
            try {
                msg[3].asString.interpret;
                // Live notes need acknowledgement of evaluation, not another server round trip.
                if(msg[4] != 0, { s.sync; });
                addr.sendMsg("/scmaker/reply", ~secret, msg[2], 1, "ok");
            } { |error|
                addr.sendMsg("/scmaker/reply", ~secret, msg[2], 0, error.asString);
                error.reportError;
            };
        }).play(SystemClock);
    });
}, "/scmaker/eval");
s.waitForBoot({
    Routine({
        SynthDef(\\scmakerClick, {
            Out.ar(0, (SinOsc.ar(1000) * EnvGen.kr(Env.perc(0.001, 0.04), doneAction: 2) * 0.08) ! 2);
        }).add;
        SynthDef(\\scmakerStrip, { |inbus, out, level = 0.7, reverb = 0.05|
            var dry = In.ar(inbus, 2);
            var wet = FreeVerb2.ar(dry[0], dry[1], reverb, 0.65, 0.5);
            Out.ar(out, wet * Lag.kr(level, 0.03));
        }).add;
        SynthDef(\\scmakerMaster, { |inbus|
            Out.ar(0, Limiter.ar(In.ar(inbus, 2), 0.85, 0.01));
        }).add;
        s.sync;
        ~buses = Array.fill(5, { Bus.audio(s, 2) });
        ~mixBus = Bus.audio(s, 2);
        ~voices = Group.head(s);
        ~fxGroup = Group.after(~voices);
        ~strips = Array.fill(5, { |i| Synth(\\scmakerStrip, [\\inbus, ~buses[i], \\out, ~mixBus], ~fxGroup) });
        ~master = Synth.tail(~fxGroup, \\scmakerMaster, [\\inbus, ~mixBus]);
        s.sync;
        ~reply.sendMsg("/scmaker/ready", ~secret);
    }).play(AppClock);
}, 100);
)
`;
}

export function projectCode(project) {
  const tracks = project.tracks.map(
    (track, i) =>
      `[\\${track.id}, ${i}, [${track.notes.map((note) => `[${note.start}, ${note.midi}, ${note.length}, ${note.velocity}]`).join(',')}]]`,
  );
  const strips = project.tracks.map(
    (track, i) =>
      `~strips[${i}].set(\\level, ${track.muted ? 0 : track.volume}, \\reverb, ${track.reverb});`,
  );
  // Muted notes do not create voices. Strip state also changes existing sustained notes.
  return `~tracks = [${tracks.join(',')}]; ~muted = [${project.tracks.map((t) => t.muted).join(',')}]; ~clock.tempo = ${project.tempo / 60}; ${strips.join('\n')}`;
}

export function playbackCode(project, captureId = null) {
  return `
~clock.stop;
~clock = TempoClock.new(${project.tempo / 60}, 0, nil, 4096);
~step = 0;
~routine = Routine({
    ${
      captureId === null
        ? ''
        : `
    ~captureId = ${captureId};
    ~captureHeld.clear;
    4.do({ |beat|
        s.makeBundle(s.latency, { Synth(\\scmakerClick); });
        ~reply.sendMsg("/scmaker/countIn", ~secret, ~captureId, 4 - beat);
        1.wait;
    });
    ~captureStart = ~clock.beats + (s.latency * ~clock.tempo);
    ~captureActive = true;
    ~reply.sendMsg("/scmaker/captureStarted", ~secret, ~captureId);
    `
    }
    ${captureId === null ? 'loop {' : `${STEPS}.do({`}
        ~tracks.do({ |track, index|
            if(~muted[index].not, {
                track[2].do({ |note|
                    if(note[0] == ~step, {
                        var voice;
                        s.makeBundle(s.latency, {
                            voice = Synth(track[0], [\\out, ~buses[track[1]], \\freq, note[1].midicps, \\amp, note[3] * 0.14], ~voices);
                        });
                        ~clock.sched(note[2] / 4, {
                            s.makeBundle(s.latency, { voice.set(\\gate, 0); });
                            nil
                        });
                    });
                });
            });
        });
        ~reply.sendMsg("/scmaker/step", ~secret, ~step);
        ~step = (~step + 1) % ${STEPS};
        0.25.wait;
    ${
      captureId === null
        ? '}'
        : `});
    (s.latency * ~clock.tempo).wait;
    ~finishCapture.();
    ~clock.clear;
    ~live.clear;
    ~voices.freeAll;
    `
    }
}).play(~clock);
`;
}

export function auditionCode(midi, reverb) {
  return `
~strips[4].set(\\level, 0.7, \\reverb, ${reverb});
{
    var voice = Synth(\\t_preview, [
        \\out, ~buses[4], \\freq, ${midi}.midicps, \\amp, 0.12
    ], ~voices).register(true);
    SystemClock.sched(0.65, {
        if(voice.isPlaying, { voice.set(\\gate, 0); });
        nil;
    });
}.value;
`;
}

export function noteOffCode(voiceId) {
  return `
~finishCapturedNote.(${scString(voiceId)}.asSymbol);
if(~live[${scString(voiceId)}.asSymbol].notNil, {
    ~live.removeAt(${scString(voiceId)}.asSymbol).set(\\gate, 0);
});
`;
}

export function noteOnCode(track, midi, voiceId) {
  return `
~strips[4].set(\\level, ${track.volume}, \\reverb, ${track.reverb});
${noteOffCode(voiceId)}
if(~captureActive and: { ~captureTrack == \\${track.id} }, {
    ~captureHeld[${scString(voiceId)}.asSymbol] = [${midi}, ~clock.beats];
});
~live[${scString(voiceId)}.asSymbol] = Synth(\\${track.id}, [
    \\out, ~buses[4], \\freq, ${midi}.midicps, \\amp, 0.14
], ~voices).register(true);
`;
}

export function safetyReleaseCode(voiceId) {
  return `
{
    var voice = ~live[${scString(voiceId)}.asSymbol];
    SystemClock.sched(12, {
        if(voice.isPlaying, { voice.set(\\gate, 0); });
        if(~live[${scString(voiceId)}.asSymbol] === voice, {
            ~live.removeAt(${scString(voiceId)}.asSymbol);
        });
        nil;
    });
}.value;
`;
}

export function recordingCode(file) {
  return `
s.recHeaderFormat = "wav";
s.recSampleFormat = "int16";
s.prepareForRecord(${scString(file)}, 2);
s.sync;
s.record;
`;
}
