const padding = (length) => (4 - (length % 4)) % 4;
function string(value) {
  const data = Buffer.from(`${value}\0`);
  return Buffer.concat([data, Buffer.alloc(padding(data.length))]);
}
export function encodeOSC(address, args = []) {
  const types = args.map((value) =>
    typeof value === 'string' ? 's' : Number.isInteger(value) ? 'i' : 'f',
  );
  const values = args.map((value, i) => {
    if (types[i] === 's') return string(value);
    const data = Buffer.alloc(4);
    if (types[i] === 'i') data.writeInt32BE(value);
    else data.writeFloatBE(value);
    return data;
  });
  return Buffer.concat([string(address), string(`,${types.join('')}`), ...values]);
}
export function decodeOSC(data) {
  let offset = 0;
  const readString = () => {
    const end = data.indexOf(0, offset);
    if (end < 0) throw new Error('Invalid OSC string.');
    const value = data.toString('utf8', offset, end);
    offset = end + 1 + padding(end + 1);
    if (offset > data.length) throw new Error('Truncated OSC message.');
    return value;
  };
  const address = readString();
  const tags = readString();
  if (!address.startsWith('/') || !tags.startsWith(',')) throw new Error('Invalid OSC message.');
  const args = [...tags.slice(1)].map((tag) => {
    if (tag === 's') return readString();
    if (!['i', 'f'].includes(tag) || offset + 4 > data.length)
      throw new Error('Invalid OSC argument.');
    const value = tag === 'i' ? data.readInt32BE(offset) : data.readFloatBE(offset);
    offset += 4;
    return value;
  });
  return { address, args };
}
