import { STEPS, synthDef } from '../shared/music.js';

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
~channels = IdentityDictionary.new;
~songChannels = List.new;
~newChannel = { |level, reverb|
    var bus = Bus.audio(s, 2);
    if(bus.isNil, { Error("SuperCollider audio buses exhausted. Reduce the active arrangement or stop unused sounds.").throw; });
    [bus, Synth(\\scmakerStrip, [\\inbus, bus, \\out, ~mixBus, \\level, level, \\reverb, reverb], ~fxGroup)]
};
~freeChannel = { |channel| channel[1].free; channel[0].free; };
~releaseSongChannels = { |channels|
    channels.do({ |channel|
        if(~songChannels.includes(channel), {
            ~songChannels.remove(channel);
            ~freeChannel.(channel);
        });
    });
};
~clearSong = { ~releaseSongChannels.(~songChannels.copy); };
~serverFailure = nil;
OSCdef(\\scmakerFailure, { |msg|
    ~serverFailure = "SuperCollider audio resource failure: " ++ msg[1..].join(" ");
    ~reply.sendMsg("/scmaker/audioError", ~secret, ~serverFailure);
}, "/fail", s.addr);
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
                ~serverFailure = nil;
                msg[3].asString.interpret;
                // Live notes need acknowledgement of evaluation, not another server round trip.
                if(msg[4] != 0, {
                    s.sync;
                    if(~serverFailure.notNil, { Error(~serverFailure).throw; });
                });
                addr.sendMsg("/scmaker/reply", ~secret, msg[2], 1, "ok");
            } { |error|
                addr.sendMsg("/scmaker/reply", ~secret, msg[2], 0, error.errorString);
                ~reply.sendMsg("/scmaker/audioError", ~secret, error.errorString);
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
        ~mixBus = Bus.audio(s, 2);
        ~voices = Group.head(s);
        ~fxGroup = Group.after(~voices);
        ~preview = ~newChannel.(0.7, 0.05);
        ~master = Synth.tail(~fxGroup, \\scmakerMaster, [\\inbus, ~mixBus]);
        s.sync;
        ~reply.sendMsg("/scmaker/ready", ~secret);
    }).play(AppClock);
}, 100);
)
`;
}

function noteData(track) {
  return `[${(track.muted ? [] : track.notes).map((note) => `[${note.start}, ${note.midi}, ${note.length}, ${note.velocity}]`).join(',')}]`;
}

// Stage one bounded command per track, then swap the complete sequence atomically.
// Channels are keyed by ID so adding instruments never reroutes existing voices.
export function projectCode(project, playing = false) {
  return [
    `~nextTracks = Array.newClear(${project.tracks.length});`,
    ...project.tracks.map(
      (track, index) => `~nextTracks[${index}] = [\\${track.id}, ${noteData(track)}];`,
    ),
    // Reclaim unused routing before allocating the next section. During a loop,
    // keep retiring channels until Stop so release voices never hit reused buses.
    ...(playing
      ? []
      : [
          `
~channels.keys.asArray.do({ |id|
    if(~nextTracks.any({ |track| (track[0] == id) and: { track[1].notEmpty } }).not, {
        ~freeChannel.(~channels.removeAt(id));
    });
});`,
        ]),
    ...project.tracks.map(
      (track) => `
{
    var channel = ~channels[\\${track.id}];
    if(channel.isNil and: { ${!track.muted && track.notes.length > 0} }, {
        channel = ~newChannel.(${track.volume}, ${track.reverb});
        ~channels[\\${track.id}] = channel;
    });
    if(channel.notNil, { channel[1].set(\\level, ${track.muted ? 0 : track.volume}, \\reverb, ${track.reverb}); });
}.value;`,
    ),
    `~tracks = ~nextTracks; ~clock.tempo = ${project.tempo / 60};`,
  ];
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
        ~tracks.do({ |track|
                track[1].do({ |note|
                    if(note[0] == ~step, {
                        var voice;
                        s.makeBundle(s.latency, {
                            voice = Synth(track[0], [\\out, ~channels[track[0]][0], \\freq, note[1].midicps, \\amp, note[3] * 0.14], ~voices);
                        });
                        ~clock.sched(note[2] / 4, {
                            s.makeBundle(s.latency, { voice.set(\\gate, 0); });
                            nil
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

// Each section has distinct synth names and strips, so sound changes never replace
// another section's definition or cut off its sustained notes and reverb.
export function songInstruments(project) {
  return project.sections.map((section, sectionIndex) =>
    section.tracks.map((track, trackIndex) => {
      const id = `t_song_${sectionIndex}_${trackIndex}`;
      return { ...track, id, code: synthDef(id, track.recipe) };
    }),
  );
}

export function songSetupCode(project) {
  return `
~clearSong.();
~channels.values.do({ |channel| ~freeChannel.(channel); });
~channels.clear;
~preview[1].set(\\level, 0);
~songSections = Array.newClear(${project.sections.length});
`;
}

export function songSectionCode(tracks, sectionIndex) {
  return [
    `~songSections[${sectionIndex}] = Array.newClear(${tracks.length});`,
    ...tracks.map(
      (track, index) =>
        `~songSections[${sectionIndex}][${index}] = [\\${track.id}, ${noteData(track)}, ${track.volume}, ${track.reverb}];`,
    ),
  ];
}

export function songPlaybackCode(project, id) {
  const order = project.arrangement.flatMap((entry, position) =>
    Array.from(
      { length: entry.repeats },
      (_, repeat) =>
        `[${project.sections.findIndex((section) => section.id === entry.sectionId)}, ${position}, ${repeat + 1}]`,
    ),
  );
  const releases = project.sections.map((section) =>
    section.tracks.reduce((max, track) => Math.max(max, track.recipe.release), 0),
  );
  const release = Math.max(...releases);
  return `
~clock.stop;
~clock = TempoClock.new(${project.tempo / 60}, 0, nil, 4096);
~routine = Routine({
    try {
    [${order.join(',')}].do({ |entry|
        var tracks = ~songSections[entry[0]];
        var channels = tracks.collect({ |track|
            var channel;
            if(track[1].notEmpty, {
                channel = ~newChannel.(track[2], track[3]);
                ~songChannels.add(channel);
            });
            channel
        });
        ${STEPS}.do({ |step|
            tracks.do({ |track, index|
                track[1].do({ |note|
                    if(note[0] == step, {
                        var voice;
                        s.makeBundle(s.latency, {
                            voice = Synth(track[0], [\\out, channels[index][0], \\freq, note[1].midicps, \\amp, note[3] * 0.14], ~voices);
                        });
                        ~clock.sched(note[2] / 4, {
                            s.makeBundle(s.latency, { voice.set(\\gate, 0); });
                            nil
                        });
                    });
                });
            });
            ~reply.sendMsg("/scmaker/songStep", ~secret, ${id}, step, entry[1], entry[2]);
            0.25.wait;
        });
        // Retiring strips stay alive for release and reverb, not for the whole song.
        SystemClock.sched([${releases.join(',')}][entry[0]] + 3 + s.latency, {
            ~releaseSongChannels.(channels.reject(_.isNil));
            nil
        });
    });
    ~reply.sendMsg("/scmaker/songTail", ~secret, ${id});
    ((${release} + 3 + s.latency) * ~clock.tempo).wait;
    ~voices.freeAll;
    ~clearSong.();
    ~reply.sendMsg("/scmaker/songFinished", ~secret, ${id});
    } { |error|
        ~reply.sendMsg("/scmaker/audioError", ~secret, error.errorString);
        error.reportError;
    };
}).play(~clock);
`;
}

export function auditionCode(midi, reverb) {
  return `
~preview[1].set(\\level, 0.7, \\reverb, ${reverb});
{
    var voice = Synth(\\t_preview, [
        \\out, ~preview[0], \\freq, ${midi}.midicps, \\amp, 0.12
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
~preview[1].set(\\level, ${track.volume}, \\reverb, ${track.reverb});
${noteOffCode(voiceId)}
if(~captureActive and: { ~captureTrack == \\${track.id} }, {
    ~captureHeld[${scString(voiceId)}.asSymbol] = [${midi}, ~clock.beats];
});
~live[${scString(voiceId)}.asSymbol] = Synth(\\${track.id}, [
    \\out, ~preview[0], \\freq, ${midi}.midicps, \\amp, 0.14
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
