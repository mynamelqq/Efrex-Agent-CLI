type Primitive = string | number | boolean | bigint | symbol | null | undefined

type Builtin = Primitive | Date | RegExp | Error

export type DeepImmutable<T> =
  T extends (...args: any[]) => any
    ? T
    : T extends Builtin
      ? T
      : T extends Promise<infer U>
        ? Promise<DeepImmutable<U>>
        : T extends Map<infer K, infer V>
          ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
          : T extends Set<infer U>
            ? ReadonlySet<DeepImmutable<U>>
            : T extends WeakMap<infer K extends object, infer V>
              ? WeakMap<K, V>
              : T extends WeakSet<infer U extends object>
                ? WeakSet<U>
                : T extends readonly (infer U)[]
                  ? readonly DeepImmutable<U>[]
                  : T extends object
                    ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
                    : T
