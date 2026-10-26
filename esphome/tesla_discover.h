// Finds each car's Bluetooth MAC from its VIN: a Tesla advertises the name "S" + sha1(VIN)[0..8] + "C".
#pragma once
#include <string>
#include <vin_utils.h>

namespace discover {
inline std::string name[2];
inline void init(const std::string &vin1, const std::string &vin2) {
  if (vin1.size() == 17) name[0] = TeslaBLE::get_vin_advertisement_name(vin1);
  if (vin2.size() == 17) name[1] = TeslaBLE::get_vin_advertisement_name(vin2);
}
inline std::string mac_str(uint64_t a) {
  char b[18];
  snprintf(b, sizeof b, "%02X:%02X:%02X:%02X:%02X:%02X", (unsigned) (a >> 40 & 0xff), (unsigned) (a >> 32 & 0xff),
           (unsigned) (a >> 24 & 0xff), (unsigned) (a >> 16 & 0xff), (unsigned) (a >> 8 & 0xff), (unsigned) (a & 0xff));
  return b;
}
inline uint64_t parse_mac(const std::string &mac) {
  uint64_t addr = 0;
  for (char c : mac) {
    int v = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    if (v >= 0) addr = (addr << 4) | v;
  }
  return addr;
}
}  // namespace discover
