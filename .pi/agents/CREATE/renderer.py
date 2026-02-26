"""Render output management for Blender skill.

Simplified version adapted from vibe-blender renderer.py.
"""

import logging
from pathlib import Path
from typing import Optional

from PIL import Image
import imageio

logger = logging.getLogger(__name__)


class RenderManager:
    """Manages render output post-processing.

    Handles grid image composition and GIF creation
    when Blender's internal rendering can't handle it.
    """

    def __init__(self, resolution: tuple[int, int] = (512, 512)):
        """Initialize the render manager.

        Args:
            resolution: Render resolution (width, height)
        """
        self.resolution = resolution

    def create_grid_image(
        self,
        image_paths: list[Path],
        output_path: Path,
        labels: Optional[list[str]] = None,
    ) -> bool:
        """Create a 2x2 grid from 4 view images.

        Args:
            image_paths: List of 4 image paths
            output_path: Output path for grid image
            labels: Optional labels for each view

        Returns:
            True if successful
        """
        if len(image_paths) != 4:
            logger.error(f"Expected 4 images, got {len(image_paths)}")
            return False

        try:
            images = []
            for path in image_paths:
                if not Path(path).exists():
                    logger.error(f"Image not found: {path}")
                    return False
                images.append(Image.open(path))

            # Create grid
            width, height = images[0].size
            grid = Image.new('RGB', (width * 2, height * 2))

            # Paste images: top-left, top-right, bottom-left, bottom-right
            positions = [(0, 0), (width, 0), (0, height), (width, height)]
            for img, pos in zip(images, positions):
                grid.paste(img, pos)

            # Add labels if provided
            if labels:
                try:
                    from PIL import ImageDraw, ImageFont
                    draw = ImageDraw.Draw(grid)
                    try:
                        # Try common font paths
                        font_paths = [
                            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                            "/System/Library/Fonts/Helvetica.ttc",
                            "/Library/Fonts/Arial.ttf",
                        ]
                        font = None
                        for font_path in font_paths:
                            try:
                                font = ImageFont.truetype(font_path, 20)
                                break
                            except:
                                continue
                        if not font:
                            font = ImageFont.load_default()
                    except:
                        font = ImageFont.load_default()

                    for label, pos in zip(labels, positions):
                        draw.text((pos[0] + 10, pos[1] + 10), label, fill="white", font=font)
                except Exception as e:
                    logger.warning(f"Could not add labels: {e}")

            grid.save(output_path)
            logger.info(f"Created grid image: {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to create grid image: {e}")
            return False

    def create_turntable_gif(
        self,
        frame_dir: Path,
        output_path: Path,
        duration: int = 100,
        pattern: str = "turntable_*.png",
    ) -> bool:
        """Create a GIF from turntable frames.

        Args:
            frame_dir: Directory containing frame images
            output_path: Output path for GIF
            duration: Frame duration in milliseconds
            pattern: Glob pattern for frame files

        Returns:
            True if successful
        """
        frame_dir = Path(frame_dir)

        try:
            # Find and sort frame files
            frames = sorted(frame_dir.glob(pattern))

            if not frames:
                logger.error(f"No frames found matching {pattern} in {frame_dir}")
                return False

            logger.info(f"Creating GIF from {len(frames)} frames")

            # Read frames
            images = [imageio.imread(str(f)) for f in frames]

            # Create GIF
            imageio.mimsave(
                str(output_path),
                images,
                duration=duration / 1000,  # imageio uses seconds
                loop=0,
            )

            logger.info(f"Created turntable GIF: {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to create GIF: {e}")
            return False
