---
name: golang-reflect-unsafe-cgo
description: Use when writing or reviewing Go code that reaches for reflect, unsafe, or cgo — struct-tag-driven marshaling, generic-looking code that can't use type parameters, binary/wire-format parsing, calling into a C library, or any code reaching for these packages for "performance."
---

# Go: reflect, unsafe, cgo

## Overview

All three break a normal guarantee (type safety, memory safety, or the Go
memory model) and all three are slower and more fragile than the code they
replace. Default to none of them. They earn their place only at a genuine
boundary: reflect at the edge where data has no static type yet (marshaling),
unsafe at the edge where you control exact memory layout (wire formats, OS
data), cgo at the edge where a required C library has no Go equivalent.

## When NOT to reach for these

- **Can generics solve it?** Use generics, not reflect. A reflect-based
  `Filter` is ~50–75x slower than a generic one and allocates thousands of
  times more (reflect's dynamic dispatch + boxing vs. compile-time
  monomorphization). Reflection is for genuinely unknown/heterogeneous types
  at runtime (CSV/JSON marshaling), not a generics substitute.
- **Comparing values in tests?** Use `slices.Equal` / `maps.Equal` (1.21+),
  not `reflect.DeepEqual` — faster, and the compiler checks the element type.
  Reach for `DeepEqual` only for arbitrary/mixed structural comparisons those
  can't express.
- **unsafe "because it's faster"?** Don't, unless you've profiled and the hot
  path is a data-boundary conversion (parsing a byte layout you don't
  control). unsafe buys real speed there (~2–2.5x for struct↔array casts) but
  costs the compiler's help catching layout mistakes.
- **cgo "because C is fast"?** Don't. A cgo call costs ~40ns and is roughly
  29x slower than a C function calling another C function — the Go/C calling
  convention and GC-safety bookkeeping dominate. Go is already faster than
  the languages (Python, Ruby) where "drop into C" pays off. Use cgo only
  when a required C library has no Go port and no existing wrapper module
  (check first — e.g. sqlite, ImageMagick wrappers already exist).

## reflect: safe patterns

- **Type vs Kind**: `Type` is the concrete name (`"Foo"`); `Kind` is the
  underlying shape (`reflect.Struct`, `reflect.Slice`, ...). Methods are
  kind-specific and panic on the wrong kind (`NumField` on a non-struct,
  `Int()` on a string). Switch on `Kind()`, or check first with `CanInt`,
  `CanSet`, `IsValid`, `IsNil` before calling the risky method.
- **Reading**: `reflect.ValueOf(v).Interface().(T)` — a plain type assertion
  back out.
- **Mutating requires a pointer**: `reflect.ValueOf(&v).Elem().SetInt(20)`.
  `reflect.ValueOf(v)` (no pointer) is read-only — `CanSet()` returns false
  and any `Set*` call panics.
- **nil-checking an interface**: check `IsValid()` first (a zero Value panics
  on everything else), then only call `IsNil()` when `Kind()` is one of
  Pointer/Slice/Map/Func/Chan/Interface — it panics on other kinds. Prefer
  writing code that tolerates a nil-valued interface instead; reserve this
  for when you truly have no other option.
- **Struct-tag marshaling**: loop `NumField`/`Field(i).Tag.Get(...)`,
  `Value.Field(i)`, switch on `Kind()` to convert. This is the shape stdlib
  `encoding/json` and friends use — fine at a genuine I/O boundary.
- **`reflect.MakeFunc`** can wrap any function (e.g., add timing) but hides
  control flow — comment clearly when a value is a reflection-generated
  function, and only do this if the wrapped work is already slow (a network
  call), or the reflection overhead dominates.
- **reflect cannot add methods** — you cannot synthesize a type that
  implements an interface at runtime.

## unsafe: safe patterns

- `unsafe.Pointer` is the only bridge between an arbitrary pointer type and
  `uintptr`. Two idioms cover almost everything: (1) type-pun via a
  pointer-cast chain (`T1 -> unsafe.Pointer -> *T2`), (2) pointer arithmetic
  via `unsafe.Add`/`unsafe.Slice` plus a `Sizeof`/`Offsetof` offset.
- `unsafe.Sizeof`/`Offsetof` are compile-time constants (usable in `const`
  exprs). Use them to reason about struct padding — grouping small fields
  (e.g. `bool`s) together instead of interleaving them with 8-byte fields
  shrinks struct size for free.
- Mapping a wire format into a struct: cast a **byte array** (not a slice —
  arrays are value types, so the bytes are contiguous and can be reinterpreted
  directly) via `unsafe.Pointer`. Still handle endianness yourself — this
  saves only the copy, not the byte-order conversion.
- Prefer `unsafe.Slice`/`unsafe.SliceData`/`unsafe.String`/`unsafe.StringData`
  over the old, now-obsolete pattern of hand-building a `reflect.SliceHeader`
  — the dedicated functions are the modern, harder-to-misuse API.
- Run tests with `-gcflags=-d=checkptr` to catch `unsafe.Pointer` misuse; it's
  not exhaustive (like the race detector) but catches real bugs cheaply.
- Reading/writing an unexported field via `reflect...FieldByName(...).Offset`
  + `unsafe.Add` works, but treat it as a last resort: it breaks
  encapsulation and silently rots if the upstream struct's field order or
  presence changes.

## cgo: safe patterns

- The core hazard is GC vs. no-GC: you cannot pass a Go value **containing a
  pointer** (string, slice, map, func, interface, or a struct holding one)
  into C — the referenced memory can move or be collected while C still
  holds it. C also cannot retain a Go pointer past the call that received
  it.
- Need a pointer-containing Go value to survive a round-trip through C? Wrap
  it with `runtime/cgo.Handle`: `cgo.NewHandle(v)` on the Go side, pass the
  handle (a `uintptr`) into C, recover it with `Handle.Value()` on the way
  back, and `Handle.Delete()` when done — don't pass the raw pointer.
- Cannot call variadic C functions (e.g. `printf`) or invoke a C function
  pointer directly (you can assign/pass it back to C, just not call it from
  Go).
- Before writing cgo glue, check for an existing wrapper module for the C
  library — most popular C libraries (SQLite, ImageMagick, ...) already have
  one, and hand-rolled cgo is easy to get subtly wrong.

## Do / Don't

```go
// Don't: reflect as a generics substitute for a known, fixed set of types.
func Sum(vals any) int {
    v := reflect.ValueOf(vals)
    sum := 0
    for i := 0; i < v.Len(); i++ {
        sum += int(v.Index(i).Int())
    }
    return sum
}

// Do: generics. Compiler-checked, no allocation, no panics on wrong type.
func Sum[T int | int32 | int64](vals []T) T {
    var sum T
    for _, v := range vals {
        sum += v
    }
    return sum
}
```

```go
// Don't: pass a Go pointer-containing value straight into C and keep using
// it after the call — the GC can move/free the backing memory underneath C.
C.store(C.uintptr_t(uintptr(unsafe.Pointer(&goStructWithAString))))

// Do: route it through a cgo.Handle instead.
h := cgo.NewHandle(goStructWithAString)
C.store(C.uintptr_t(h))
// ... later, from the exported Go callback: h.Value().(MyType); h.Delete()
```

## Pitfalls checklist

- Calling a `reflect` method that doesn't match the value's `Kind` → panic;
  guard with `Kind()`/`CanX()` first.
- Passing a non-pointer to `reflect.ValueOf` when you intend to mutate →
  silent `CanSet() == false`, then a panic on `Set`.
- Casting a `[]byte` slice (not array) into a struct via `unsafe.Pointer`
  without going through `unsafe.SliceData` — slices carry length/cap/pointer,
  not raw contiguous value bytes.
- Forgetting endianness when mapping wire bytes with `unsafe` — the cast
  saves the copy, not the byte order.
- Storing a Go pointer (or anything containing one) across a cgo boundary
  without a `cgo.Handle`.
- Reaching for cgo for speed instead of for an unavailable C-only library.
