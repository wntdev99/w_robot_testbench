# Copyright 2026 WATT — Apache-2.0
"""ament_python setup — w_robot_testbench 백엔드.

의존성은 package.xml(rosdep)이 SSOT. 여기선 패키지/엔트리포인트만.
모듈 소스는 backend/ 아래 (package_dir로 루트 매핑).
"""
from setuptools import find_packages, setup

PACKAGE_NAME = "w_robot_testbench"

setup(
    name=PACKAGE_NAME,
    version="0.3.0",
    package_dir={"": "backend"},
    packages=find_packages(where="backend", exclude=["test", "test.*"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{PACKAGE_NAME}"]),
        (f"share/{PACKAGE_NAME}", ["package.xml"]),
        # config 는 런타임 읽기 — share 설치 (TODO: config.py 경로를 share 참조로 보강)
        (f"share/{PACKAGE_NAME}/config", ["config/testbench.yaml", "config/baseline.yaml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="jeongmin.choi",
    maintainer_email="jeongmin.choi@wattrobotics.ai",
    description="웹 기반 ROS2 로봇 테스트벤치 (DESIGN v0.3)",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "testbench = testbench.main:main",
        ],
    },
)
