"""Unit tests for eval/metrics.py — nDCG@10."""
from eval.metrics import ndcg_at_10


def test_ndcg_perfect_ordering_is_1():
    grades = ["relevant"] * 5 + ["unmarked"] * 5
    assert ndcg_at_10(grades) == 1.0


def test_ndcg_all_false_friends_is_0():
    grades = ["false_friend"] * 10
    assert ndcg_at_10(grades) == 0.0


def test_ndcg_relevant_at_top_better_than_at_bottom():
    top = ["relevant"] * 3 + ["unmarked"] * 7
    bottom = ["unmarked"] * 7 + ["relevant"] * 3
    assert ndcg_at_10(top) > ndcg_at_10(bottom)


def test_ndcg_false_friend_in_top_3_punishes():
    a = ["relevant", "false_friend", "relevant"] + ["unmarked"] * 7
    b = ["relevant", "unmarked", "relevant"] + ["unmarked"] * 7
    assert ndcg_at_10(a) < ndcg_at_10(b)


def test_ndcg_truncates_to_10():
    short = ["relevant", "unmarked", "false_friend"] + ["unmarked"] * 7
    long_ = short + ["relevant"] * 5
    assert ndcg_at_10(long_) == ndcg_at_10(short)


def test_ndcg_handles_empty():
    assert ndcg_at_10([]) == 0.0
