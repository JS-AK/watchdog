{
  "targets": [
    {
      "target_name": "watchdog",
      "sources": [
        "native/addon.cpp",
        "native/watchdog.cpp",
        "native/logger.cpp",
        "native/metrics.cpp"
      ],
      "include_dirs": [
        "native"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "LanguageStandard": "stdcpp20"
        }
      },
      "conditions": [
        [
          "OS==\"win\"",
          {
            "libraries": ["-lpsapi"]
          }
        ],
        [
          "OS==\"linux\"",
          {
            "cflags_cc": ["-std=c++20"]
          }
        ],
        [
          "OS==\"mac\"",
          {
            "cflags_cc": ["-std=c++20"]
          }
        ]
      ]
    }
  ]
}
