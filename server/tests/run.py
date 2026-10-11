"""Esegue tutti i test su un database di test separato.

    python -m tests.run            (tutti)
    python -m tests.run -k Magazzino
"""
import sys
import unittest

from tests.helpers import Server


def main():
    argv = sys.argv[1:]
    loader = unittest.TestLoader()
    if "-k" in argv:
        loader.testNamePatterns = [f"*{argv[argv.index('-k') + 1]}*"]
    suite = loader.discover("tests", pattern="test_*.py", top_level_dir=".")
    Server.start()
    try:
        res = unittest.TextTestRunner(verbosity=2).run(suite)
    finally:
        Server.stop()
    sys.exit(0 if res.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
