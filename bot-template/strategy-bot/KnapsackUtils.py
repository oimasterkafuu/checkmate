"""Knapsack helpers with optional native acceleration and pure-Python fallback."""

from __future__ import annotations

import math
import time
import typing

import logbook

_KNAPSACK_CPP = None
_KNAPSACK_CPP_ERROR: Exception | None = None

try:
    import cppimport  # type: ignore

    _KNAPSACK_CPP = cppimport.imp('KnapsackUtilsCpp')
except Exception as ex:  # pragma: no cover - environment dependent
    _KNAPSACK_CPP_ERROR = ex
    _KNAPSACK_CPP = None


T = typing.TypeVar('T')


def _solve_multiple_choice_knapsack_purepy(
    items: list[T],
    capacity: int,
    weights: list[int],
    values: list[int],
    groups: list[int],
    noLog: bool,
    longRuntimeThreshold: float,
) -> tuple[int, list[T]]:
    if len(items) == 0:
        return 0, []

    if groups[0] != 0:
        raise AssertionError(
            'Groups must start with 0 and increment by one for each new group. Items should be ordered by group.',
        )

    group_start_ends: list[tuple[int, int]] = []
    last_group = -1
    last_group_index = 0
    max_group_size = 0
    cur_group_size = 0

    for i, group in enumerate(groups):
        if group > last_group:
            if cur_group_size > max_group_size:
                max_group_size = cur_group_size
            if last_group > -1:
                group_start_ends.append((last_group_index, i))
                cur_group_size = 0
            if group > last_group + 1:
                raise AssertionError(
                    'Groups must have no gaps. if you have group 0 and 2, group 1 must be included between them.',
                )
            last_group_index = i
            last_group = group

        cur_group_size += 1

    group_start_ends.append((last_group_index, len(groups)))
    if cur_group_size > max_group_size:
        max_group_size = cur_group_size

    if values and not isinstance(values[0], int):
        raise AssertionError('values are all required to be ints or this algo will not function')

    n = len(values)
    est_time = n * capacity * math.sqrt(max_group_size) * 0.00000022
    if max_group_size == n:
        est_time = n * capacity * 0.00000022

    if est_time > longRuntimeThreshold:
        raise AssertionError(
            f'Knapsack potential long run est {est_time:.3f}: '
            f'the inputs (n {n} * capacity {capacity} * sqrt(maxGroupSize {max_group_size})) may be too slow',
        )

    if not noLog:
        logbook.info(
            f'estimated knapsack time: {est_time:.3f} '
            f'(n {n} * capacity {capacity} * sqrt(maxGroupSize {max_group_size}))',
        )

    # K[i][c] -> best value using first i items with capacity c
    K = [[0 for _ in range(capacity + 1)] for _ in range(n + 1)]

    for cur_capacity in range(capacity + 1):
        for i in range(n + 1):
            if i == 0 or cur_capacity == 0:
                K[i][cur_capacity] = 0
            elif weights[i - 1] <= cur_capacity:
                sub_max = 0
                prev_group = groups[i - 1] - 1
                sub_row = cur_capacity - weights[i - 1]
                if prev_group > -1:
                    prev_start, prev_end = group_start_ends[prev_group]
                    for j in range(prev_start + 1, prev_end + 1):
                        if groups[j - 1] == prev_group and K[j][sub_row] > sub_max:
                            sub_max = K[j][sub_row]
                K[i][cur_capacity] = max(sub_max + values[i - 1], K[i - 1][cur_capacity])
            else:
                K[i][cur_capacity] = K[i - 1][cur_capacity]

    result = K[n][capacity]
    picked: list[T] = []
    picked_groups: list[int] = []
    w = capacity
    last_taken_group = -1

    for i in range(n, 0, -1):
        if result <= 0:
            break
        if w < 0:
            raise AssertionError(f'w < 0 in knapsack reconstruction: result={result}, i={i}, w={w}')
        if result == K[i - 1][w]:
            continue

        group = groups[i - 1]
        if group == last_taken_group:
            continue

        picked_groups.append(group)
        last_taken_group = group
        picked.append(items[i - 1])
        result -= values[i - 1]
        w -= weights[i - 1]

    if len(set(picked_groups)) != len(picked_groups):
        raise AssertionError('multiple-choice knapsack selected duplicated groups')

    return K[n][capacity], picked


def solve_multiple_choice_knapsack(
    items: list[T],
    capacity: int,
    weights: list[int],
    values: list[int],
    groups: list[int],
    noLog: bool = True,
    longRuntimeThreshold: float = 0.005,
) -> tuple[int, list[T]]:
    """Native-first knapsack; falls back to pure Python if native module is unavailable."""

    if _KNAPSACK_CPP is not None:
        return _KNAPSACK_CPP.solve_multiple_choice_knapsack(
            items,
            capacity,
            weights,
            values,
            groups,
            noLog,
            longRuntimeThreshold,
        )

    # Reduce log noise: print once when fallback is activated.
    global _KNAPSACK_CPP_ERROR
    if _KNAPSACK_CPP_ERROR is not None:
        logbook.warning(
            f'KnapsackUtilsCpp unavailable, falling back to pure Python implementation: {_KNAPSACK_CPP_ERROR}',
        )
        _KNAPSACK_CPP_ERROR = None

    return _solve_multiple_choice_knapsack_purepy(
        items,
        capacity,
        weights,
        values,
        groups,
        noLog,
        longRuntimeThreshold,
    )


def solve_knapsack(
    items: list[T],
    capacity: int,
    weights: list[int],
    values: list[int],
) -> tuple[int, list[T]]:
    """0-1 knapsack (kept for compatibility with existing modules/tests)."""

    for value in values:
        if not isinstance(value, int):
            raise AssertionError('values are all required to be ints or this algo will not function')

    time_start = time.perf_counter()
    n = len(items)
    K = [[0 for _ in range(capacity + 1)] for _ in range(n + 1)]

    for i in range(n + 1):
        for w in range(capacity + 1):
            if i == 0 or w == 0:
                K[i][w] = 0
            elif weights[i - 1] <= w:
                K[i][w] = max(values[i - 1] + K[i - 1][w - weights[i - 1]], K[i - 1][w])
            else:
                K[i][w] = K[i - 1][w]

    res = K[n][capacity]
    included_items: list[T] = []
    w = capacity

    for i in range(n, 0, -1):
        if res <= 0:
            break
        if w < 0:
            raise AssertionError(f'w < 0 in knapsack reconstruction: res={res}, i={i}, w={w}')
        if res == K[i - 1][w]:
            continue

        included_items.append(items[i - 1])
        res -= values[i - 1]
        w -= weights[i - 1]

    logbook.info(
        f'knapsack completed on {n} items for capacity {capacity} '
        f'finding value {K[n][capacity]} in {time.perf_counter() - time_start:.3f}s',
    )

    return K[n][capacity], included_items
