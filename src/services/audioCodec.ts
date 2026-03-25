const MU_LAW_BIAS = 0x84;
const MU_LAW_CLIP = 32635;

const decodeMuLawByte = (value: number): number => {
  const mu = ~value & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  const sample = ((mantissa << 3) + MU_LAW_BIAS) << exponent;
  return sign ? MU_LAW_BIAS - sample : sample - MU_LAW_BIAS;
};

const encodeMuLawSample = (sample: number): number => {
  let pcm = Math.max(-32768, Math.min(32767, sample));
  let sign = 0;

  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }

  pcm = Math.min(pcm, MU_LAW_CLIP);
  pcm += MU_LAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent -= 1;
  }

  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
};

export const decodeMuLawBuffer = (payload: Buffer): Int16Array => {
  const out = new Int16Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[i] = decodeMuLawByte(payload[i]);
  }
  return out;
};

export const encodeMuLawBuffer = (samples: Int16Array): Buffer => {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = encodeMuLawSample(samples[i]);
  }
  return out;
};

export const resampleLinear = (input: Int16Array, fromRate: number, toRate: number): Int16Array => {
  if (input.length === 0 || fromRate === toRate) {
    return input;
  }

  const ratio = toRate / fromRate;
  const outputLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const srcPos = i / ratio;
    const left = Math.floor(srcPos);
    const right = Math.min(left + 1, input.length - 1);
    const weight = srcPos - left;
    const sample = input[left] * (1 - weight) + input[right] * weight;
    out[i] = Math.round(sample);
  }

  return out;
};

export const int16ToPcmBuffer = (input: Int16Array): Buffer => {
  const out = Buffer.alloc(input.length * 2);
  for (let i = 0; i < input.length; i += 1) {
    out.writeInt16LE(input[i], i * 2);
  }
  return out;
};

export const pcmBufferToInt16 = (buffer: Buffer): Int16Array => {
  const sampleCount = Math.floor(buffer.length / 2);
  const out = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = buffer.readInt16LE(i * 2);
  }
  return out;
};
