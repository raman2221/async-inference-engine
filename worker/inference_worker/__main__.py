import asyncio
import logging

from .config import Config
from .worker import run

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="[worker] %(asctime)s %(levelname)s %(message)s")
    asyncio.run(run(Config.from_env()))
