// Минимальные объявления вместо всей библиотеки DOM: пакет живёт и в браузере, и в Workers.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

declare function btoa(data: string): string;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
