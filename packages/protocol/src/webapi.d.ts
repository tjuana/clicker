// Minimal declarations instead of the whole DOM lib: this package lives in both the browser and Workers.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

declare function btoa(data: string): string;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
