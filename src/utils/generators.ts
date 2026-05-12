const NO_VALUE = Symbol('NO_VALUE')

export async function lastX<A>(as: AsyncGenerator<A>): Promise<A> {//异步生成器
  let lastValue: A | typeof NO_VALUE = NO_VALUE//定义一个标记 NO_VALUE 来判断生成器是否有值。
  for await (const a of as) {//从一个异步生成器里取出 最后一个值。
    lastValue = a
  }
  if (lastValue === NO_VALUE) {
    throw new Error('No items in generator')
  }
  return lastValue//否则返回最后一个值。
}

export async function returnValue<A>(//获取一个异步生成器的 返回值（return 语句返回的值），而不是 yield 出来的值
  as: AsyncGenerator<unknown, A>,
): Promise<A> {
  let e
  do {
    //不断调用 next() 来推进生成器，直到它完成（done 为 true）。当生成器完成时，next() 方法返回一个对象，其中 value 属性包含 return 语句返回的值。
    e = await as.next()
  } while (!e.done)
  return e.value
}

type QueuedGenerator<A> = {//定义一个结构，表示 正在排队的生成器及其状态。
  done: boolean | void//生成器是否完成
  value: A | void//最新产出的值
  generator: AsyncGenerator<A, void>//对应的异步生成器
  promise: Promise<QueuedGenerator<A>>//下一次 next() 的 Promise
}

// 同时启动所有生成器，直至达到并发上限，然后在数据产生时立即输出这些值。
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void> {//把多个异步生成器 并发运行，按照值产生的顺序输出，支持限制最大并发数 concurrencyCap
  const next = (generator: AsyncGenerator<A, void>) => {
    const promise: Promise<QueuedGenerator<A>> = generator//定义一个函数 next(generator)：返回一个 Promise，等生成器产生下一个值。
      .next()
      .then(({ done, value }) => ({
        done,
        value,
        generator,
        promise,
      }))
    return promise
  }
  const waiting = [...generators]//还没启动的生成器
  const promises = new Set<Promise<QueuedGenerator<A>>>()

  // Start initial batch up to concurrency cap
  while (promises.size < concurrencyCap && waiting.length > 0) {//把初始的一批生成器放进 promises 集合
    const gen = waiting.shift()!
    promises.add(next(gen))
  }
// 使用 Promise.race(promises)：
// 哪个生成器先产生值就先处理它。
// 如果生成器没结束，就把它的下一次 next() 加入 promises。
// 如果生成器结束，就从 waiting 里取下一个生成器加入。
// 最终 yield 所有生成器产出的值。
  while (promises.size > 0) {//等待生成器产出
    const { done, value, generator, promise } = await Promise.race(promises)//Promise.race(promises)：哪个生成器先有值就先处理哪个。
    promises.delete(promise)//取出 Promise resolve 的结果，解构成 done、value、generator。

    if (!done) {//生成器没结束，就把它的下一次 next() 加入 promises。
      promises.add(next(generator))
      // TODO: Clean this up
      if (value !== undefined) {//当前值如果不是 undefined，就 yield 出去
        yield value as Awaited<A>
      }
    } else if (waiting.length > 0) {
      // Start a new generator when one finishes
      const nextGen = waiting.shift()!// 启动一个新的生成器补位
      promises.add(next(nextGen))
    }
  }
}

export async function toArray<A>(//把一个异步生成器的所有值收集到数组里。就是把异步“流”变成“数组”。
  generator: AsyncGenerator<A, void>,
): Promise<A[]> {
  const result: A[] = []
  for await (const a of generator) {
    result.push(a)
  }
  return result
}

export async function* fromArray<T>(values: T[]): AsyncGenerator<T, void> {//把一个普通数组转换成异步生成器。
  for (const value of values) {
    yield value
  }
}
