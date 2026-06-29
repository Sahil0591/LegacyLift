"""
tests/conftest.py — pytest configuration for LegacyLift test suite.

Sets asyncio_mode = "auto" so all async test functions are automatically
detected without needing the @pytest.mark.asyncio decorator on each one.
"""
import pytest


def pytest_configure(config):
    """Register the asyncio_mode ini option."""
    config.addinivalue_line(
        "markers", "asyncio: mark test as async"
    )
